// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmRequest, LlmResponse } from '../types';
import type { ModelGroup } from '../modelCatalog';

// The transports are replaced so each test scripts exactly what the provider
// "answers"; the model chain under test is the real one.
const replies: Array<(req: LlmRequest) => LlmResponse> = [];
const calls: LlmRequest[] = [];
function next(req: LlmRequest): LlmResponse {
  calls.push(req);
  const reply = replies.shift();
  if (!reply) throw new Error('no scripted reply left');
  return reply(req);
}

vi.mock('../providerTransports', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../providerTransports')>();
  return {
    ...mod,
    completeOpenAiCompatible: async (_p: string, req: LlmRequest) => next(req),
    streamOpenAiCompatible: async (_p: string, req: LlmRequest, opts: { onToken: (t: string) => void }) => {
      const res = next(req);
      if (res.content) opts.onToken(res.content);
      return res;
    },
  };
});

import { setPlatform, type Platform } from '@platform/index';
import { completeWithModelChain, streamWithModelChain } from '../ProviderRegistry';
import { emptyReplyAction, raisedTokenBudget } from '../failover';
import { parseOpenAiStreamLine } from '../streamParsers';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';

const groups: ModelGroup[] = [
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    keyName: 'llm.deepseek',
    models: [{ value: 'cloud:deepseek:thinker', label: 'Thinker', shortLabel: 'Thinker' }],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    keyName: 'llm.openai',
    models: [{ value: 'cloud:openai:writer', label: 'Writer', shortLabel: 'Writer' }],
  },
];

beforeEach(() => {
  // Every provider reads as having a key, so failover has somewhere to go.
  setPlatform({ secrets: { retrieve: async () => 'test-key' } } as unknown as Platform);
  replies.length = 0;
  calls.length = 0;
  useModelCatalogStore.setState((state) => ({ ...state, groups }));
});

describe('emptyReplyAction', () => {
  it('leaves a reply with text or a tool call alone', () => {
    expect(emptyReplyAction({ content: 'answer', finishReason: 'length' }, false)).toBe('none');
    expect(emptyReplyAction({ content: '', toolCalls: [{}], finishReason: 'stop' }, false)).toBe('none');
  });

  it('raises the budget once for an empty length stop, then moves on', () => {
    expect(emptyReplyAction({ content: '', finishReason: 'length' }, false)).toBe('raise-budget');
    expect(emptyReplyAction({ content: '  ', finishReason: 'max_tokens' }, false)).toBe('raise-budget');
    expect(emptyReplyAction({ content: '', finishReason: 'length' }, true)).toBe('fail-over');
  });

  it('moves to another model for an empty reply that stopped normally', () => {
    expect(emptyReplyAction({ content: '', finishReason: 'stop' }, false)).toBe('fail-over');
    expect(emptyReplyAction({ content: '' }, false)).toBe('fail-over');
  });

  it('raises the cap to at least three times the original, within bounds', () => {
    expect(raisedTokenBudget(2200)).toBe(6600);
    expect(raisedTokenBudget(1000)).toBe(6000);
    expect(raisedTokenBudget(9000)).toBe(16_000);
    expect(raisedTokenBudget(undefined)).toBe(6000);
  });
});

describe('reasoning chunks', () => {
  it('flags a reasoning-only chunk without turning it into answer text', () => {
    const line = 'data: {"choices":[{"delta":{"reasoning_content":"weighing the records"}}]}';
    const parsed = parseOpenAiStreamLine(line);
    expect(parsed?.delta).toBe('');
    expect(parsed?.reasoning).toBe(true);
  });

  it('does not flag an ordinary answer chunk', () => {
    const parsed = parseOpenAiStreamLine('data: {"choices":[{"delta":{"content":"Grade D"}}]}');
    expect(parsed?.delta).toBe('Grade D');
    expect(parsed?.reasoning).toBeUndefined();
  });
});

describe('model chain on an empty reply', () => {
  it('streams: retries the same model with room to finish after an empty length stop', async () => {
    replies.push(
      () => ({ content: '', toolCalls: [], finishReason: 'length' }),
      () => ({ content: 'Grade D — Major', toolCalls: [], finishReason: 'stop' }),
    );
    const res = await streamWithModelChain(
      'cloud:deepseek:thinker',
      { messages: [{ role: 'user', content: 'grade it' }], maxTokens: 2200 },
      { onToken: () => {} },
    );
    expect(res.content).toBe('Grade D — Major');
    expect(res.modelUsed).toBe('cloud:deepseek:thinker');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.maxTokens).toBe(2200);
    expect(calls[1]?.maxTokens).toBe(6600);
  });

  it('streams: moves to another model when the retry is empty too', async () => {
    replies.push(
      () => ({ content: '', toolCalls: [], finishReason: 'length' }),
      () => ({ content: '', toolCalls: [], finishReason: 'length' }),
      () => ({ content: 'written', toolCalls: [], finishReason: 'stop' }),
    );
    const res = await streamWithModelChain(
      'cloud:deepseek:thinker',
      { messages: [{ role: 'user', content: 'grade it' }], maxTokens: 2200 },
      { onToken: () => {} },
    );
    expect(res.content).toBe('written');
    expect(res.modelUsed).toBe('cloud:openai:writer');
    expect(res.failover.switchedTo).toEqual(['cloud:openai:writer']);
    // The new model starts from the caller's own cap, not the raised one.
    expect(calls[2]?.maxTokens).toBe(2200);
  });

  it('completes: an empty normal stop fails over instead of returning nothing', async () => {
    replies.push(
      () => ({ content: '', toolCalls: [], finishReason: 'stop' }),
      () => ({ content: 'findings', toolCalls: [], finishReason: 'stop' }),
    );
    const res = await completeWithModelChain('cloud:deepseek:thinker', {
      messages: [{ role: 'user', content: 'summarise' }],
      maxTokens: 1300,
    });
    expect(res.content).toBe('findings');
    expect(res.modelUsed).toBe('cloud:openai:writer');
  });

  it('completes: returns the empty reply when no other model is available', async () => {
    useModelCatalogStore.setState((state) => ({ ...state, groups: [groups[0]!] }));
    replies.push(
      () => ({ content: '', toolCalls: [], finishReason: 'stop' }),
    );
    const res = await completeWithModelChain('cloud:deepseek:thinker', {
      messages: [{ role: 'user', content: 'summarise' }],
    });
    expect(res.content).toBe('');
    expect(calls).toHaveLength(1);
  });
});
