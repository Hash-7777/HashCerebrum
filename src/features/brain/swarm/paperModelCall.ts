// One model call for the paper pipeline, with the recovery a long run needs:
// shrink an oversized prompt and retry, wait out a provider's advertised rate
// limit (capped, so one slow provider cannot stall the whole paper), and stop
// at once when every provider in the chain is billing-dead. A silent failover
// to another model is surfaced in the trace.

import { completeWithModelChain } from '@core/llm/ProviderRegistry';
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
      return response.content.trim();
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
