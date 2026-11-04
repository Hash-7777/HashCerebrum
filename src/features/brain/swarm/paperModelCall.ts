// One model call for the paper pipeline, with the recovery a long run needs:
// shrink an oversized prompt and retry, wait out a provider's advertised rate
// limit (capped, so one slow provider cannot stall the whole paper), and stop
// at once when every provider in the chain is billing-dead. A silent failover
// to another model is surfaced in the trace.

import { completeWithModelChain, CONTINUE_INSTRUCTION, joinContinuation } from '@core/llm/ProviderRegistry';
import {
  isBillingDead as isCallBillingDead,
  isContextTooLarge as isCallTooLarge,
  isRateLimited as isCallRateLimited,
  retryAfterMs as parseRetryAfterMs,
} from '@core/llm/errorKind';
import { bus } from '@core/bus/EventBus';

const MIN_CALL_CHARS = 4_000;

const MAX_CALL_RATE_RETRIES = 3;

// Longest we will honor a provider's advertised cooldown. Free tiers sometimes
// advertise very long waits (the trace showed a 195s cooldown); stalling the run
// for minutes per call is worse than failing the section fast and letting the
// user re-run on Auto / a less-limited provider, so we cap the wait.
const MAX_RATE_WAIT_MS = 20_000;

// How many times a section that hit the output cap is continued before the
// pipeline keeps what it has.
const MAX_SECTION_CONTINUATIONS = 2;

function isLengthStop(reason: string | undefined): boolean {
  const r = (reason ?? '').toLowerCase();
  return r === 'length' || r === 'max_tokens';
}

/**
 * Cut text back to the end of its last complete sentence (keeping any citation
 * markers that close it). A section that stopped at the output cap otherwise
 * ends mid-sentence, and the reader cannot tell what the sentence was going to
 * claim. Text with no sentence end at all is returned as it is.
 */
export function trimToLastSentence(text: string): string {
  const trimmed = text.trimEnd();
  let cut = -1;
  for (const m of trimmed.matchAll(/[.!?](?:\s*\[S?\d+\])*["')\]]?(?=\s|$)/g)) {
    cut = (m.index ?? 0) + m[0].length;
  }
  return cut > 0 ? trimmed.slice(0, cut) : trimmed;
}

function callSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callModel(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  noPause = false,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error('Run stopped by user');
  // Surface a silent boss-model failover in the trace so a mid-run provider
  // outage is visible rather than only changing the model label afterwards.
  const onProgress = (progress: { to: { shortLabel: string }; reason: string }) => {
    bus.emit('agent:activity', {
      agentId: 'boss',
      phase: 'tool_call',
      detail: `model unavailable — switched to ${progress.to.shortLabel} (${progress.reason.slice(0, 80)})`,
    });
  };

  let content = user;
  let tokenCap = maxTokens;
  let rateRetries = 0;
  for (;;) {
    try {
      const response = await completeWithModelChain(
        model,
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
          temperature: 0.22,
          maxTokens: tokenCap,
        },
        onProgress,
      );
      // A section that reached the output cap is continued on the same model and
      // joined at a word boundary; if it is still cut off after that, it is
      // trimmed back to its last complete sentence rather than ending mid-claim.
      let text = response.content;
      let stop = response.finishReason;
      for (let i = 0; i < MAX_SECTION_CONTINUATIONS && isLengthStop(stop) && text.trim(); i += 1) {
        if (signal?.aborted) break;
        let more;
        try {
          more = await completeWithModelChain(
            model,
            {
              messages: [
                { role: 'system', content: system },
                { role: 'user', content },
                { role: 'assistant', content: text },
                { role: 'user', content: CONTINUE_INSTRUCTION },
              ],
              temperature: 0.22,
              maxTokens: tokenCap,
            },
            onProgress,
          );
        } catch {
          // Keep what was written; the trim below closes it at a sentence end.
          break;
        }
        text += joinContinuation(text, more.content);
        stop = more.finishReason;
      }
      if (isLengthStop(stop)) text = trimToLastSentence(text);
      return text.trim();
    } catch (err) {
      if (isCallTooLarge(err) && content.length > MIN_CALL_CHARS) {
        content = content.slice(0, Math.max(MIN_CALL_CHARS, Math.floor(content.length / 2)));
        tokenCap = Math.min(tokenCap, 1500);
        bus.emit('agent:activity', {
          agentId: 'boss',
          phase: 'tool_call',
          detail: `section prompt too large — retrying smaller (${content.length} chars)`,
        });
        continue;
      }
      // Hard billing failure — the failover chain has already excluded the dead
      // provider. If this surfaces here, every provider in the chain is dead.
      // Surface immediately; do not stall in retry loops.
      if (isCallBillingDead(err)) {
        bus.emit('agent:activity', {
          agentId: 'boss',
          phase: 'error',
          detail: `all providers billing-dead — section draft aborted`,
        });
        throw err;
      }
      // Brain Mini deliberately does NOT pause on rate limits — it fails fast
      // (the section gets flagged) so a low-quota run never stalls in backoff.
      if (isCallRateLimited(err) && !noPause && rateRetries < MAX_CALL_RATE_RETRIES) {
        rateRetries += 1;
        // Honor the provider's advertised cooldown when it states one (a short
        // wait like 8s lets the next retry actually succeed); otherwise fall back
        // to exponential backoff. Cap either so a very long advertised cooldown
        // never stalls the whole run.
        const advertised = parseRetryAfterMs(err);
        const backoff = Math.min(8_000, 1_000 * 2 ** (rateRetries - 1));
        const waitMs = Math.min(MAX_RATE_WAIT_MS, advertised ?? backoff) + Math.floor(Math.random() * 400);
        bus.emit('agent:activity', {
          agentId: 'boss',
          phase: 'tool_call',
          detail: `rate-limited — pausing ${Math.round(waitMs / 1000)}s before retry`,
        });
        await callSleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}
