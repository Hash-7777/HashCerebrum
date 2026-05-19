import { describe, expect, it } from 'vitest';
import {
  findBestFailover,
  isHardProviderError,
  isRetriableError,
  shouldRetrySameProvider,
} from '../failover';
import type { ModelGroup } from '../modelCatalog';
import type { LlmProviderId } from '../types';

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

  it('treats model incompatibility as failover-worthy', () => {
    expect(isHardProviderError(new Error('model not found'))).toBe(true);
    expect(isHardProviderError(new Error('tool calling not supported'))).toBe(true);
  });
});
