import { platform } from '@platform/index';
import { DEFAULT_MODEL, PROVIDER_DEFS, parseModelRef, providerKeyName } from './modelCatalog';
import {
  cooldownProvider,
  deadProvidersThisSession,
  emptyReplyAction,
  findBestFailover,
  isBillingError,
  isHardProviderError,
  isModelUnusableError,
  isProviderOnCooldown,
  isRetriableError,
  markModelUnusable,
  markProviderBillingDead,
  raisedTokenBudget,
  shouldRetrySameProvider,
  type FailoverCandidate,
} from './failover';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { getPrivacyLocalOnly } from './providerSettings';
import type { LlmProviderId, LlmRequest, LlmResponse } from './types';
import {
  isJailbreakAttempt,
  isOffTopicQuestion,
  isSelfHarmQuery,
  isHarmfulRequest,
  SELF_HARM_MESSAGE,
  HARMFUL_REQUEST_REFUSAL,
} from './safety';
import { logModelUsage } from './usageLog';
import {
  completeOpenAiCompatible,
  completeOllama,
  completeAnthropic,
  completeGemini,
  type StreamOptions,
  streamOllama,
  streamOpenAiCompatible,
  streamAnthropic,
  streamGemini,
} from './providerTransports';

export { getOllamaHost, getPrivacyLocalOnly, setOllamaHost, setPrivacyLocalOnly } from './providerSettings';

export async function streamWithModel(
  modelValue: string,
  req: Omit<LlmRequest, 'model'>,
  opts: StreamOptions,
): Promise<LlmResponse> {
  const parsed = parseModelRef(modelValue || DEFAULT_MODEL);
  if (parsed.kind === 'cloud' && getPrivacyLocalOnly()) {
    throw new Error('Privacy Local Only is enabled. Select an Ollama model or turn it off in Settings.');
  }
  const request = { ...req, model: parsed.model };
  if (parsed.provider === 'ollama') return streamOllama(request, opts);
  if (parsed.provider === 'anthropic') return streamAnthropic(request, opts);
  if (parsed.provider === 'gemini') return streamGemini(request, opts);
  return streamOpenAiCompatible(parsed.provider, request, opts);
}

// Handed to the next model when a stream is cut off mid-answer, so the switch
// is seamless instead of truncating (cf. switching Opus→Sonnet mid-task).
export const CONTINUE_INSTRUCTION =
  'Your previous response was cut off mid-stream. Continue it from exactly where it stopped. ' +
  'Begin by repeating, word for word, the last few words you wrote, then carry straight on. ' +
  'Do not restart, do not repeat anything earlier than those last words, and add no preamble.';

// How much of a continuation is held back before it is joined to what was
// already written. Enough to find the repeated words the continuation is asked
// to open with; small enough that the pause is not noticeable.
const JOIN_WINDOW_CHARS = 160;

/**
 * The text to append when a continuation leg (after a length stop or a
 * mid-stream model switch) is joined to what was already written.
 *
 * The continuation is asked to open by repeating the last few words; when it
 * does, that overlap is removed, which also mends a word cut in half. When it
 * does not, a space is put back between two words: a new reply never starts with
 * the space that separated them, which is how "summary" and "of" came out as
 * "summaryof".
 */
export function joinContinuation(written: string, next: string): string {
  const maxOverlap = Math.min(next.length, written.length, 300);
  for (let k = maxOverlap; k >= 3; k -= 1) {
    const head = next.slice(0, k);
    if (!written.endsWith(head)) continue;
    // The repeat must start where a word starts in what was written, so a
    // continuation that merely begins with the same letters is not clipped.
    const before = written.charAt(written.length - k - 1);
    if (before === '' || /[\s([*_"'\u2014-]/.test(before)) return next.slice(k);
  }
  const trimmedNext = next.replace(/^[ \t]+/, '');
  const lastChar = written.slice(-1);
  const firstChar = trimmedNext.charAt(0);
  if (!lastChar || !firstChar || /\s/.test(lastChar)) return trimmedNext;
  const endsInWord = /[\p{L}\p{N}.,;:!?)\]*_]/u.test(lastChar);
  const startsWord = /[\p{L}\p{N}(\[*_]/u.test(firstChar);
  return endsInWord && startsWord ? ` ${trimmedNext}` : trimmedNext;
}

// Streaming variant of completeWithModelChain. On a retriable failure BEFORE any
// token is emitted, it restarts fresh on the next model. On a retriable failure
// AFTER tokens have streamed, it now RESUMES the answer on the next model
// (feeding it what was written so far) rather than truncating — so a mid-stream
// model switch reads as one continuous answer.
export async function streamWithModelChain(
  modelValue: string,
  req: Omit<LlmRequest, 'model'>,
  opts: StreamOptions,
  onProgress?: (progress: FailoverProgress) => void,
): Promise<FailoverResult> {
  const tried = new Set<string>();
  let current = modelValue || DEFAULT_MODEL;
  let lastError: unknown;
  const switchedTo: string[] = [];

  const keyCache = new Map<LlmProviderId, boolean>();
  const providerRetries = new Map<LlmProviderId, number>();
  const hasKey = async (provider: LlmProviderId) => {
    let cached = keyCache.get(provider);
    if (cached === undefined) {
      cached = await hasStoredKey(provider);
      keyCache.set(provider, cached);
    }
    return cached;
  };
  const hasKeySync = (provider: LlmProviderId) => keyCache.get(provider) === true;
  await Promise.all(PROVIDER_DEFS.filter((g) => !!g.keyName).map((g) => hasKey(g.provider)));
  const modelGroups = useModelCatalogStore.getState().groups;
  // Whether this call uses tools — failover then prefers tool-capable models.
  const needsTools = (req.tools?.length ?? 0) > 0;

  let failovers = 0;
  let acc = ''; // everything emitted so far, across every model leg
  let resuming = false; // true once we are continuing a cut-off response
  let lengthContinuations = 0; // bounded resumes after hitting a model output cap
  // Set once an empty, length-stopped reply has been retried with a larger cap
  // on the current model (see emptyReplyAction).
  let budgetRaised = false;
  let maxTokensOverride: number | undefined;
  // Real token usage summed across every leg — each failover/continuation is a
  // separate API call that costs its own input+output tokens.
  let chainIn = 0;
  let chainOut = 0;
  let measured = false;
  while (failovers <= MAX_FAILOVERS) {
    // If the preferred model's provider is cooling down from a recent rate
    // limit / credit failure, fail over immediately rather than re-hitting it.
    if (
      !tried.has(current) &&
      (isProviderOnCooldown(parseModelRef(current).provider) ||
        deadProvidersThisSession().has(parseModelRef(current).provider))
    ) {
      let warm = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
      while (warm && isProviderOnCooldown(warm.provider)) {
        tried.add(warm.value);
        warm = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
      }
      if (warm) {
        tried.add(current);
        failovers++;
        switchedTo.push(warm.value);
        onProgress?.({ from: current, to: warm, attempt: failovers, reason: 'provider cooling down from a recent rate limit' });
        current = warm.value;
      }
    }
    tried.add(current);

    // On a continuation leg, give the next model what was written so far and ask
    // it to resume seamlessly. Rebuild the request with only prose fields — tools
    // are intentionally dropped (this is a prose continuation, not tool calling).
    let legReq: Omit<LlmRequest, 'model'> = req;
    if (resuming) {
      legReq = {
        messages: [
          ...req.messages,
          { role: 'assistant', content: acc },
          { role: 'user', content: CONTINUE_INSTRUCTION },
        ],
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
        ...(req.tools?.length ? { tools: req.tools } : {}),
      };
    }
    if (maxTokensOverride !== undefined) legReq = { ...legReq, maxTokens: maxTokensOverride };

    let receivedThisLeg = false;
    // On a continuation leg the opening text is held back until it can be joined
    // cleanly to what was already written (see joinContinuation).
    let joinPending: string | null = resuming ? '' : null;
    const flushJoin = () => {
      if (joinPending === null) return;
      const joined = joinContinuation(acc, joinPending);
      joinPending = null;
      if (!joined) return;
      acc += joined;
      opts.onToken(joined);
    };
    // First-token watchdog: abort this leg (but not the whole turn) if a cloud
    // model does not begin streaming in time, so failover picks a faster model.
    let firstTokenTimedOut = false;
    const legController = new AbortController();
    const onExternalAbort = () => legController.abort();
    if (opts.signal) {
      if (opts.signal.aborted) legController.abort();
      else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const guardFirstToken = parseModelRef(current).kind === 'cloud';
    const firstTokenTimer = guardFirstToken
      ? setTimeout(() => {
          if (!receivedThisLeg) {
            firstTokenTimedOut = true;
            legController.abort();
          }
        }, FIRST_TOKEN_TIMEOUT_MS)
      : undefined;
    try {
      const response = await streamWithModel(current, legReq, {
        onToken: (token) => {
          if (!receivedThisLeg && firstTokenTimer) clearTimeout(firstTokenTimer);
          receivedThisLeg = true;
          if (joinPending !== null) {
            joinPending += token;
            if (joinPending.length >= JOIN_WINDOW_CHARS) flushJoin();
            return;
          }
          acc += token;
          opts.onToken(token);
        },
        // Reasoning before the first answer word means the model is working,
        // not stalled: stand the first-token watchdog down for this leg.
        onActivity: () => {
          if (firstTokenTimer) clearTimeout(firstTokenTimer);
        },
        signal: legController.signal,
      });
      flushJoin();
      if (response.usage) {
        chainIn += response.usage.inputTokens;
        chainOut += response.usage.outputTokens;
        measured = true;
      }
      // Free-tier models often cap output and stop cleanly mid-answer
      // (finish_reason 'length'/'max_tokens'). Resume on the SAME model from
      // what was written so far, so a small output cap doesn't truncate a long
      // answer. Bounded, and never on an abort.
      const fr = (response.finishReason ?? '').toLowerCase();
      if (
        (fr === 'length' || fr === 'max_tokens') &&
        acc.length > 0 &&
        lengthContinuations < MAX_LENGTH_CONTINUATIONS &&
        !opts.signal?.aborted
      ) {
        lengthContinuations += 1;
        resuming = true;
        continue; // same model continues from acc
      }
      const empty = acc.length === 0 && !opts.signal?.aborted ? emptyReplyAction(response, budgetRaised) : 'none';
      if (empty === 'raise-budget') {
        budgetRaised = true;
        maxTokensOverride = raisedTokenBudget(req.maxTokens);
        continue; // same model, room for its reasoning and the answer
      }
      if (empty === 'fail-over') {
        const next = nextUsableModel(current, tried, hasKeySync, modelGroups, needsTools);
        if (next) {
          failovers++;
          switchedTo.push(next.value);
          onProgress?.({ from: current, to: next, attempt: failovers, reason: 'the model returned an empty reply' });
          current = next.value;
          budgetRaised = false;
          maxTokensOverride = undefined;
          continue;
        }
      }
      if (measured) logModelUsage(current, { inputTokens: chainIn, outputTokens: chainOut });
      return {
        ...response,
        content: acc, // full answer across all legs, not just the last one
        modelUsed: current,
        failover: { attempted: switchedTo.length, switchedTo },
      };
    } catch (error) {
      flushJoin();
      // A watchdog abort surfaces as a bare AbortError; translate it into a
      // retriable timeout so the chain fails over instead of giving up.
      if (firstTokenTimedOut && !opts.signal?.aborted) {
        error = new Error(`first-token timeout: ${parseModelRef(current).provider} did not start streaming — failing over`);
      }
      lastError = error;
      if (opts.signal?.aborted) break;
      const parsed = parseModelRef(current);
      // A model that is gone / not accessible to this key is retired for the
      // session so failover, auto-assignment, and the picker stop offering it.
      if (isModelUnusableError(error)) markModelUnusable(current);

      if (receivedThisLeg) {
        // Mid-stream interruption. If retriable and budget remains, RESUME the
        // answer on another model rather than truncating it.
        if (!isRetriableError(error) && !isHardProviderError(error)) break;
        cooldownProvider(parsed.provider, error);
        let cont = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
        while (cont && isProviderOnCooldown(cont.provider)) {
          tried.add(cont.value);
          cont = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
        }
        if (!cont) break;
        failovers++;
        switchedTo.push(cont.value);
        onProgress?.({ from: current, to: cont, attempt: failovers, reason: 'resuming after a mid-stream interruption' });
        current = cont.value;
        resuming = true;
        continue;
      }

      // No tokens yet on this leg — safe to restart fresh on the same/next model.
      const retries = providerRetries.get(parsed.provider) ?? 0;
      if (shouldRetrySameProvider(error) && retries < 1) {
        providerRetries.set(parsed.provider, retries + 1);
        await delayWithJitter(RETRY_WAIT_MS, opts.signal);
        continue;
      }
      if (!isRetriableError(error) && !isHardProviderError(error)) break;
      // Park a rate-limited / out-of-credits provider so later calls skip it.
      cooldownProvider(parsed.provider, error);
      if (isBillingError(error)) {
        // A billing/credit failure is account-wide — abandon every model
        // from this provider so the chain escapes to a working one.
        markProviderBillingDead(parsed.provider);
        for (const group of modelGroups) {
          if (group.provider === parsed.provider) {
            for (const model of group.models) tried.add(model.value);
          }
        }
      }
      let next = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
      while (next && (isProviderOnCooldown(next.provider) || deadProvidersThisSession().has(next.provider))) {
        tried.add(next.value);
        next = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
      }
      if (!next) break;
      failovers++;
      switchedTo.push(next.value);
      onProgress?.({
        from: current,
        to: next,
        attempt: failovers,
        reason: error instanceof Error ? error.message : String(error),
      });
      current = next.value;
    } finally {
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
      opts.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  // Budget/abort exhausted. If a partial answer already streamed, return it (the
  // user can see it — better than discarding); otherwise surface the error.
  if (acc) {
    return { content: acc, toolCalls: [], modelUsed: current, failover: { attempted: switchedTo.length, switchedTo } };
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'unknown LLM error'));
}

/**
 * Safety-wrapped variant of `streamWithModelChain`.
 * All prompts are scanned for self-harm, harmful requests, jailbreak, and
 * off-topic patterns BEFORE any token is streamed. If a violation is found,
 * a deterministic refusal is returned immediately (no model call, no cost,
 * no leakage to downstream evidence extraction). This is the single choke-point
 * for safety across Brain, Peer Review, editor, and rewrite paths.
 */
export async function streamWithModelSafe(
  modelValue: string,
  req: Omit<LlmRequest, 'model'>,
  opts: StreamOptions,
  onProgress?: (progress: FailoverProgress) => void,
): Promise<FailoverResult> {
  const text = (req.messages ?? [])
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');

  if (isSelfHarmQuery(text)) {
    return {
      content: SELF_HARM_MESSAGE,
      toolCalls: [],
      modelUsed: 'safety_gate',
      failover: { attempted: 0, switchedTo: [] },
    };
  }
  if (isHarmfulRequest(text) || isJailbreakAttempt(text) || isOffTopicQuestion(text)) {
    return {
      content: HARMFUL_REQUEST_REFUSAL,
      toolCalls: [],
      modelUsed: 'safety_gate',
      failover: { attempted: 0, switchedTo: [] },
    };
  }

  return streamWithModelChain(modelValue, req, opts, onProgress);
}

export async function completeWithModel(modelValue: string, req: Omit<LlmRequest, 'model'>): Promise<LlmResponse> {
  const parsed = parseModelRef(modelValue || DEFAULT_MODEL);
  if (parsed.kind === 'cloud' && getPrivacyLocalOnly()) {
    throw new Error('Privacy Local Only is enabled. Select an Ollama model or turn it off in Settings.');
  }
  const request = { ...req, model: parsed.model };
  if (parsed.provider === 'ollama') return completeOllama(request);
  if (parsed.provider === 'anthropic') return completeAnthropic(request);
  if (parsed.provider === 'gemini') return completeGemini(request);
  return completeOpenAiCompatible(parsed.provider, request);
}

export type ModelProbe = 'ok' | 'unusable' | 'unknown';

/**
 * Liveness-probe a single model with a minimal 1-token request. Returns:
 *  - 'ok'       the model answered — it is usable with this key
 *  - 'unusable' the model is gone / not accessible (definitive) — it is retired
 *               for the session via markModelUnusable
 *  - 'unknown'  transient failure (rate limit, overload, timeout, network) —
 *               the model is NOT condemned; it is just busy right now
 * Never throws. Local (Ollama) models are reported 'ok' without a call so a probe
 * does not force a cold model load on device.
 */
export async function probeModelUsable(modelValue: string): Promise<ModelProbe> {
  if (parseModelRef(modelValue).kind !== 'cloud') return 'ok';
  try {
    await completeWithModel(modelValue, {
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 1,
      temperature: 0,
    });
    return 'ok';
  } catch (error) {
    if (isModelUnusableError(error)) {
      markModelUnusable(modelValue);
      return 'unusable';
    }
    return 'unknown';
  }
}

export interface FailoverInfo {
  attempted: number;
  switchedTo: string[];
}

export interface FailoverProgress {
  from: string;
  to: FailoverCandidate;
  attempt: number;
  reason: string;
}

export interface FailoverResult extends LlmResponse {
  modelUsed: string;
  failover: FailoverInfo;
}

const MAX_FAILOVERS = 4;

/** The best failover candidate whose provider is neither cooling down nor dead
 *  for this session, or null. */
function nextUsableModel(
  current: string,
  tried: Set<string>,
  hasKeySync: (provider: LlmProviderId) => boolean,
  modelGroups: Parameters<typeof findBestFailover>[3],
  needsTools: boolean,
): FailoverCandidate | null {
  let next = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
  while (next && (isProviderOnCooldown(next.provider) || deadProvidersThisSession().has(next.provider))) {
    tried.add(next.value);
    next = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
  }
  return next;
}
// First-token watchdog: how long a cloud model may take to emit its FIRST token
// before we abandon the leg and fail over. An overloaded/slow provider otherwise
// blocks the whole turn until the 600s HTTP timeout — the reason a trivial chat
// could hang for many seconds. Only the first token is guarded; once a model is
// streaming, it may take as long as it needs. Local (Ollama) legs are exempt —
// they can be slow to warm and have no cloud to fail over to.
const FIRST_TOKEN_TIMEOUT_MS = 12_000;
// How many times a length-capped generation may be resumed on the same model
// before we return what we have — bounds total output on free-tier caps.
const MAX_LENGTH_CONTINUATIONS = 4;
const RETRY_WAIT_MS = 2000;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Stream aborted'));
    }, { once: true });
  });
}

/** Retry delay with ±25 % jitter so parallel clients don't thunder-herd. */
function delayWithJitter(baseMs: number, signal?: AbortSignal): Promise<void> {
  const jitter = baseMs * 0.25 * (Math.random() * 2 - 1);
  return delay(Math.max(100, Math.round(baseMs + jitter)), signal);
}

async function hasStoredKey(provider: LlmProviderId): Promise<boolean> {
  const keyName = providerKeyName(provider);
  if (!keyName) return false;
  try {
    const value = await platform().secrets.retrieve(keyName);
    return !!value;
  } catch {
    return false;
  }
}

// completeWithModelChain — try selected model; on a retriable cloud
// failure (429 / 503 / 5xx), switch to the next-best cloud model whose
// key is available. Local models never auto-failover into the cloud.
// Returns the final response plus the chain that was walked, so the UI
// can show the user which provider actually answered.
export async function completeWithModelChain(
  modelValue: string,
  req: Omit<LlmRequest, 'model'>,
  onProgress?: (progress: FailoverProgress) => void,
): Promise<FailoverResult> {
  const tried = new Set<string>();
  let current = modelValue || DEFAULT_MODEL;
  let lastError: unknown;
  const switchedTo: string[] = [];

  const keyCache = new Map<LlmProviderId, boolean>();
  const providerRetries = new Map<LlmProviderId, number>();
  const hasKey = async (provider: LlmProviderId) => {
    let cached = keyCache.get(provider);
    if (cached === undefined) {
      cached = await hasStoredKey(provider);
      keyCache.set(provider, cached);
    }
    return cached;
  };
  const hasKeySync = (provider: LlmProviderId) => keyCache.get(provider) === true;
  await Promise.all(PROVIDER_DEFS.filter((g) => !!g.keyName).map((g) => hasKey(g.provider)));
  const modelGroups = useModelCatalogStore.getState().groups;
  // Whether this call uses tools — failover then prefers tool-capable models.
  const needsTools = (req.tools?.length ?? 0) > 0;

  let failovers = 0;
  let budgetRaised = false;
  let maxTokensOverride: number | undefined;
  while (failovers <= MAX_FAILOVERS) {
    // If the preferred model's provider is cooling down from a recent rate
    // limit / credit failure, fail over immediately rather than re-hitting it.
    if (
      !tried.has(current) &&
      (isProviderOnCooldown(parseModelRef(current).provider) ||
        deadProvidersThisSession().has(parseModelRef(current).provider))
    ) {
      let warm = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
      while (warm && isProviderOnCooldown(warm.provider)) {
        tried.add(warm.value);
        warm = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
      }
      if (warm) {
        tried.add(current);
        failovers++;
        switchedTo.push(warm.value);
        onProgress?.({ from: current, to: warm, attempt: failovers, reason: 'provider cooling down from a recent rate limit' });
        current = warm.value;
      }
    }
    tried.add(current);
    try {
      const legReq = maxTokensOverride !== undefined ? { ...req, maxTokens: maxTokensOverride } : req;
      const response = await completeWithModel(current, legReq);
      logModelUsage(current, response.usage);
      const empty = emptyReplyAction(response, budgetRaised);
      if (empty === 'raise-budget') {
        budgetRaised = true;
        maxTokensOverride = raisedTokenBudget(req.maxTokens);
        continue;
      }
      if (empty === 'fail-over') {
        const next = nextUsableModel(current, tried, hasKeySync, modelGroups, needsTools);
        if (next) {
          failovers++;
          switchedTo.push(next.value);
          onProgress?.({ from: current, to: next, attempt: failovers, reason: 'the model returned an empty reply' });
          current = next.value;
          budgetRaised = false;
          maxTokensOverride = undefined;
          continue;
        }
      }
      return {
        ...response,
        modelUsed: current,
        failover: { attempted: switchedTo.length, switchedTo },
      };
    } catch (error) {
      lastError = error;
      const parsed = parseModelRef(current);
      if (isModelUnusableError(error)) markModelUnusable(current);
      const retries = providerRetries.get(parsed.provider) ?? 0;
      if (shouldRetrySameProvider(error) && retries < 1) {
        providerRetries.set(parsed.provider, retries + 1);
        await delayWithJitter(RETRY_WAIT_MS);
        continue;
      }
      if (!isRetriableError(error) && !isHardProviderError(error)) break;
      // Park a rate-limited / out-of-credits provider so later calls skip it.
      cooldownProvider(parsed.provider, error);
      if (isBillingError(error)) {
        // A billing/credit failure is account-wide — abandon every model
        // from this provider so the chain escapes to a working one.
        markProviderBillingDead(parsed.provider);
        for (const group of modelGroups) {
          if (group.provider === parsed.provider) {
            for (const model of group.models) tried.add(model.value);
          }
        }
      }
      let next = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
      while (next && (isProviderOnCooldown(next.provider) || deadProvidersThisSession().has(next.provider))) {
        tried.add(next.value);
        next = findBestFailover(current, tried, hasKeySync, modelGroups, needsTools);
      }
      if (!next) break;
      failovers++;
      switchedTo.push(next.value);
      onProgress?.({
        from: current,
        to: next,
        attempt: failovers,
        reason: error instanceof Error ? error.message : String(error),
      });
      current = next.value;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'unknown LLM error'));
}
