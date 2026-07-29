// What kind of failure a provider just returned, decided in one place.
//
// WHY THIS MODULE EXISTS
//
// These questions — is this a rate limit, is the prompt too big, is the account
// out of credits, how long should we wait — were answered independently in the
// paper pipeline, the peer-review swarm and the failover chain. Two copies were
// byte-for-byte identical, the rest had quietly drifted, and every drift was a
// bug waiting for the right provider message:
//
//   * A "tokens per minute" 429 read as a context-size error sent the code into
//     a shrink loop that burned the whole timeout and failed every agent.
//   * Gemini phrases its FREE-tier 429 as "check your plan and billing details".
//     A billing check matching the bare word "billing" read that as a dead
//     account and shipped an INCOMPLETE DRAFT where a short wait would have
//     finished the section.
//   * The paper pipeline's context check was missing "reduce your message",
//     which the review swarm had — so the same recoverable error was shrinkable
//     in one half of the app and fatal in the other.
//   * The review swarm's retry parser only understood "try again in 8.5s", so
//     it ignored Gemini's "retryDelay: 12s" and OpenAI's "Retry-After: 20" and
//     fell back to blind backoff where the paper pipeline waited exactly right.
//
// PRECEDENCE IS THE POINT
//
// Provider messages routinely satisfy more than one pattern, so the ORDER these
// are asked in is the actual fix, not the patterns themselves. A rate limit is
// checked first and wins over everything, because both bugs above came from
// something transient being read as permanent. Retrying a genuinely dead call
// costs one wasted request; abandoning a recoverable one costs the user their
// answer.

export type LlmErrorKind =
  | 'rate_limited'
  | 'context_too_large'
  | 'billing_dead'
  | 'unknown';

function text(err: unknown): string {
  return (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
}

/**
 * A rate or quota limit: requests-per-minute, tokens-per-minute, a daily quota,
 * or a cooldown after a recent 429.
 *
 * Shrinking the prompt does not help here — only waiting, or a fresh provider,
 * does. "tokens per minute" belongs in this list and not in the context-size
 * one, which is the distinction the shrink-loop bug turned on.
 */
export function isRateLimited(err: unknown): boolean {
  const m = text(err);
  return (
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('rate_limit') ||
    m.includes('quota') ||
    m.includes('requests per minute') ||
    m.includes('tokens per minute') ||
    // "too many REQUESTS" only. A bare "too many" also matches "too many
    // tokens", which is an oversized prompt — and since rate limits are checked
    // first, broadening this would classify every context overflow as a rate
    // limit and stop the shrink path from ever running.
    m.includes('too many requests') ||
    m.includes('cooling down') ||
    m.includes('cooldown')
  );
}

/**
 * The prompt is physically too big for the model's context window.
 *
 * Recoverable by sending less. Union of what the two former copies matched, so
 * neither half of the app is now blind to a phrasing the other handled.
 */
export function isContextTooLarge(err: unknown): boolean {
  const m = text(err);
  return (
    m.includes('413') ||
    m.includes('request too large') ||
    m.includes('reduce your message') ||
    m.includes('context length') ||
    m.includes('context_length') ||
    m.includes('maximum context') ||
    m.includes('too many tokens')
  );
}

/**
 * A hard billing failure: the account cannot pay for the call.
 *
 * Deliberately narrow, and deliberately deferential to `isRateLimited`. Only an
 * explicit 402 / insufficient-credits / payment-required signal counts, and a
 * message that also reads as a rate limit is treated as the rate limit instead.
 * Several providers word a free-tier throttle in billing language, and the cost
 * of the two mistakes is not symmetric: waiting on a truly dead account wastes
 * one request, while giving up on a throttled one loses the user's work.
 */
export function isBillingDead(err: unknown): boolean {
  if (isRateLimited(err)) return false;
  const m = text(err);
  return (
    m.includes('402') ||
    m.includes('insufficient credits') ||
    m.includes('insufficient_credits') ||
    m.includes('payment required')
  );
}

/**
 * Classify in one call. The order below is the contract — see the header.
 */
export function classifyLlmError(err: unknown): LlmErrorKind {
  if (isRateLimited(err)) return 'rate_limited';
  if (isContextTooLarge(err)) return 'context_too_large';
  if (isBillingDead(err)) return 'billing_dead';
  return 'unknown';
}

/**
 * The cooldown a provider advertises, in milliseconds, or undefined when none
 * is stated so the caller can fall back to its own backoff.
 *
 * Providers phrase this many ways — Groq "Please try again in 8.522s" or "in
 * 2m30s", Gemini "retryDelay: 12s" or "retry after 30 seconds", OpenAI-style
 * "Retry-After: 20". Parsing is anchored to a cooldown phrase so a stray number
 * elsewhere in the message is never mistaken for a delay. Honouring a short
 * advertised wait lets the very next retry succeed where a blind 2s wait would
 * 429 again.
 *
 * The value is returned as advertised; capping it is the caller's decision,
 * since a run that can afford a 20s stall and one that cannot are different
 * situations.
 */
export function retryAfterMs(err: unknown): number | undefined {
  const lower = text(err);
  const anchor =
    /(?:try again in|again in|retry[- ]?delay["']?\s*[:=]?|retry[- ]?after:?|retry in|available in|wait(?:\s+for)?)\s*["']?/;
  const m = anchor.exec(lower);
  if (!m) return undefined;
  const tail = lower.slice(m.index + m[0].length);
  // Compound "2m30s" / "1m 30s".
  const compound = tail.match(/^(\d+)\s*m(?:in(?:ute)?s?)?\s*(\d+(?:\.\d+)?)\s*s/);
  if (compound) return Math.round((Number(compound[1]) * 60 + Number(compound[2])) * 1000);
  const ms = tail.match(/^(\d+(?:\.\d+)?)\s*ms\b/);
  if (ms) return Math.round(Number(ms[1]));
  const sec = tail.match(/^(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\b/);
  if (sec) return Math.round(Number(sec[1]) * 1000);
  const min = tail.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?\b/);
  if (min) return Math.round(Number(min[1]) * 60_000);
  // Bare number immediately after the anchor (e.g. "Retry-After: 20" → seconds).
  const bare = tail.match(/^(\d+(?:\.\d+)?)\b/);
  if (bare) return Math.round(Number(bare[1]) * 1000);
  return undefined;
}
