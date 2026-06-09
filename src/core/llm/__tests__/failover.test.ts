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

  it('prefers a fresh provider over another model on the just-failed provider at equal tier', () => {
    const tieGroups: ModelGroup[] = [
      {
        provider: 'groq',
        label: 'Groq',
        keyName: 'llm.groq',
        models: [
          { value: 'cloud:groq:openai/gpt-oss-120b', label: 'GPT OSS 120B', shortLabel: 'OSS' },
          { value: 'cloud:groq:nemotron-ultra', label: 'Nemotron Ultra', shortLabel: 'Nemotron' },
        ],
      },
      {
        provider: 'anthropic',
        label: 'Anthropic',
        keyName: 'llm.anthropic',
        models: [{ value: 'cloud:anthropic:claude-opus', label: 'Claude Opus', shortLabel: 'Opus' }],
      },
    ];
    const all = (_: LlmProviderId) => true;
    // gpt-oss-120b just failed on groq; nemotron-ultra (groq) and claude-opus
    // (anthropic) are both tier 400. The fresh provider must win.
    const next = findBestFailover('cloud:groq:openai/gpt-oss-120b', new Set(['cloud:groq:openai/gpt-oss-120b']), all, tieGroups);
    expect(next?.provider).toBe('anthropic');
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

  it('skips a model that cannot tool-call when the failed call needs tools', () => {
    const toolGroups: ModelGroup[] = [
      {
        provider: 'openrouter',
        label: 'OpenRouter',
        keyName: 'llm.openrouter',
        models: [
          { value: 'cloud:openrouter:free-405b', label: 'Free 405B', shortLabel: 'Free', supportsTools: false },
          { value: 'cloud:openrouter:tooly', label: 'Tooly', shortLabel: 'Tooly', supportsTools: true },
        ],
      },
    ];
    const all = (_: LlmProviderId) => true;
    const tried = new Set(['cloud:groq:openai/gpt-oss-120b']);
    // needsTools=true must skip the no-tool model even though it is listed first.
    const next = findBestFailover('cloud:groq:openai/gpt-oss-120b', tried, all, toolGroups, true);
    expect(next?.value).toBe('cloud:openrouter:tooly');
    // Without the tool requirement, the no-tool model is eligible again.
    const any = findBestFailover('cloud:groq:openai/gpt-oss-120b', tried, all, toolGroups, false);
    expect(any).not.toBeNull();
  });

  it('treats model incompatibility as failover-worthy', () => {
    expect(isHardProviderError(new Error('model not found'))).toBe(true);
    expect(isHardProviderError(new Error('tool calling not supported'))).toBe(true);
  });
});
