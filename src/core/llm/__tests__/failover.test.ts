import { describe, expect, it } from 'vitest';
import {
  cooldownProvider,
  findBestFailover,
  isBillingError,
  isHardProviderError,
  isProviderOnCooldown,
  isRetriableError,
  shouldRetrySameProvider,
} from '../failover';
import type { ModelGroup } from '../modelCatalog';
import type { LlmProviderId } from '../types';

describe('provider cooldown', () => {
  it('parks a rate-limited provider and clears a clean one', () => {
    expect(isProviderOnCooldown('gemini')).toBe(false);
    cooldownProvider('gemini', new Error('HTTP 429: You exceeded your current quota'));
    expect(isProviderOnCooldown('gemini')).toBe(true);
    // A non-retriable error does not trigger a cooldown.
    cooldownProvider('groq', new Error('invalid_request_error: bad json'));
    expect(isProviderOnCooldown('groq')).toBe(false);
  });

  it('parks an out-of-credits provider', () => {
    cooldownProvider('openrouter', new Error('HTTP 402: Insufficient credits'));
    expect(isProviderOnCooldown('openrouter')).toBe(true);
  });
});

const groups: ModelGroup[] = [
  {
    provider: 'openai',
    label: 'OpenAI',
    keyName: 'llm.openai',
    models: [{ value: 'cloud:openai:gpt-5.2', label: 'GPT-5.2 · OpenAI', shortLabel: 'GPT-5.2' }],
  },
  {
    provider: 'groq',
    label: 'Groq',
    keyName: 'llm.groq',
    models: [{ value: 'cloud:groq:openai/gpt-oss-120b', label: 'GPT OSS 120B · Groq', shortLabel: 'GPT OSS 120B' }],
  },
  {
    provider: 'gemini',
    label: 'Google Gemini',
    keyName: 'llm.gemini',
    models: [{ value: 'cloud:gemini:gemini-2.5-pro', label: 'Gemini 2.5 Pro · Google', shortLabel: 'Gemini Pro' }],
  },
];

const hasKey = (provider: LlmProviderId) => provider !== 'openai';

describe('LLM failover', () => {
  it('builds fallback candidates from discovered connected model groups', () => {
    const next = findBestFailover('cloud:openai:gpt-5.2', new Set(['cloud:openai:gpt-5.2']), hasKey, groups);
    expect(next?.value).toBe('cloud:groq:openai/gpt-oss-120b');
  });

  it('distinguishes transient retry from quota exhaustion', () => {
    expect(isRetriableError(new Error('HTTP 429 rate limit'))).toBe(true);
    expect(shouldRetrySameProvider(new Error('HTTP 429 temporary rate limit'))).toBe(true);
    expect(shouldRetrySameProvider(new Error('quota exceeded, update billing'))).toBe(false);
  });

  it('fails over on a billing/credit error instead of surfacing it', () => {
    const creditError = new Error(
      'openrouter HTTP 402: {"error":{"message":"Insufficient credits.","code":402}}',
    );
    // Retriable -> the chain switches providers...
    expect(isRetriableError(creditError)).toBe(true);
    // ...but never retries the same broke provider.
    expect(shouldRetrySameProvider(creditError)).toBe(false);
    // ...and is recognised as account-wide so the whole provider is dropped.
    expect(isBillingError(creditError)).toBe(true);
    expect(isBillingError(new Error('HTTP 429 rate limit'))).toBe(false);
  });

  it('treats model incompatibility as failover-worthy', () => {
    expect(isHardProviderError(new Error('model not found'))).toBe(true);
    expect(isHardProviderError(new Error('tool calling not supported'))).toBe(true);
  });
});
