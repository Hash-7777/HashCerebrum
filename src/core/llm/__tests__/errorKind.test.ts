import { describe, expect, it } from 'vitest';
import {
  classifyLlmError,
  isBillingDead,
  isContextTooLarge,
  isRateLimited,
  retryAfterMs,
} from '../errorKind';

// Real provider strings. Every one of these was seen in a trace, and the first
// three each caused a shipped bug when a copy of this logic got it wrong.
const REAL = {
  geminiFreeTier429:
    '429 Too Many Requests: You exceeded your current quota. Please check your plan and billing details. retryDelay: 12s',
  groqTpm:
    'Rate limit reached for model `llama-3.3-70b` : Limit 6000 tokens per minute. Please try again in 8.522s',
  openaiTooLong:
    "This model's maximum context length is 8192 tokens. Please reduce your message and try again.",
  groq413: 'HTTP 413: Request too large for model, limit 6000 tokens',
  openrouter402: 'HTTP 402: Insufficient credits. Add more at openrouter.ai/credits',
  openaiRetryAfter: 'HTTP 429 rate_limit_exceeded. Retry-After: 20',
  groqLongCooldown: 'Rate limit reached. Please try again in 2m30s',
} as const;

describe('rate limits win over everything else', () => {
  // The bug: a free-tier 429 phrased in billing language was read as a dead
  // account, so the section aborted and shipped an INCOMPLETE DRAFT instead of
  // waiting twelve seconds and finishing.
  it('reads a free-tier 429 that mentions billing as a rate limit, not a dead account', () => {
    expect(classifyLlmError(REAL.geminiFreeTier429)).toBe('rate_limited');
    expect(isBillingDead(REAL.geminiFreeTier429)).toBe(false);
  });

  // The bug: "tokens per minute" read as a context-size error sent the code into
  // a shrink loop that burned the whole timeout and failed every agent.
  it('reads a tokens-per-minute limit as a rate limit, never as an oversized prompt', () => {
    expect(classifyLlmError(REAL.groqTpm)).toBe('rate_limited');
    expect(isContextTooLarge(REAL.groqTpm)).toBe(false);
  });
});

describe('oversized prompts', () => {
  // The bug: the paper pipeline was missing "reduce your message", so the same
  // recoverable error was shrinkable in peer review and fatal in the Brain.
  it('recognises the phrasing that only one half of the app used to catch', () => {
    expect(classifyLlmError(REAL.openaiTooLong)).toBe('context_too_large');
  });

  it('recognises a 413', () => {
    expect(classifyLlmError(REAL.groq413)).toBe('context_too_large');
  });

  // "too many tokens" and "too many requests" are opposite diagnoses that share
  // a prefix. Because rate limits are asked first, matching a bare "too many"
  // would swallow every oversized prompt and stop the shrink path running at all.
  it('does not confuse too many tokens with too many requests', () => {
    expect(classifyLlmError('Error: too many tokens in the request')).toBe('context_too_large');
    expect(classifyLlmError('Error: too many requests, slow down')).toBe('rate_limited');
  });
});

describe('billing', () => {
  it('recognises a genuine out-of-credits failure', () => {
    expect(classifyLlmError(REAL.openrouter402)).toBe('billing_dead');
    expect(isRateLimited(REAL.openrouter402)).toBe(false);
  });

  it('does not fire on the word billing alone', () => {
    expect(isBillingDead('Please check your plan and billing details')).toBe(false);
  });
});

describe('advertised cooldowns', () => {
  // The review swarm only understood "try again in Xs" and ignored the rest,
  // falling back to blind backoff where the paper pipeline waited correctly.
  it('reads every phrasing the providers actually use', () => {
    expect(retryAfterMs(REAL.groqTpm)).toBe(8522);
    expect(retryAfterMs(REAL.geminiFreeTier429)).toBe(12_000);
    expect(retryAfterMs(REAL.openaiRetryAfter)).toBe(20_000);
    expect(retryAfterMs(REAL.groqLongCooldown)).toBe(150_000);
  });

  it('returns undefined when no delay is advertised, so the caller backs off', () => {
    expect(retryAfterMs('HTTP 429 rate limit reached')).toBeUndefined();
    expect(retryAfterMs('some unrelated failure')).toBeUndefined();
  });

  it('never mistakes an unrelated number for a delay', () => {
    // "6000 tokens per minute" must not be read as a 6000-second wait.
    expect(retryAfterMs('Limit 6000 tokens per minute for model gpt-4o')).toBeUndefined();
  });
});

describe('unknown failures stay unknown', () => {
  it('does not guess', () => {
    expect(classifyLlmError('failed to fetch')).toBe('unknown');
    expect(classifyLlmError('HTTP 500 internal server error')).toBe('unknown');
    expect(classifyLlmError(new Error('socket hang up'))).toBe('unknown');
  });

  it('handles a non-Error argument without throwing', () => {
    expect(classifyLlmError(undefined)).toBe('unknown');
    expect(classifyLlmError(null)).toBe('unknown');
    expect(classifyLlmError({ weird: true })).toBe('unknown');
  });
});
