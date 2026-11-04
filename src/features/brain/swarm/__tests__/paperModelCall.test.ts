import { beforeEach, describe, expect, it, vi } from 'vitest';

type Reply = { content: string; finishReason?: string };
const replies: Reply[] = [];
const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];

vi.mock('@core/llm/ProviderRegistry', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@core/llm/ProviderRegistry')>();
  return {
    ...mod,
    completeWithModelChain: async (_model: string, req: { messages: Array<{ role: string; content: string }> }) => {
      requests.push(req);
      const reply = replies.shift();
      if (!reply) throw new Error('rate limit: no scripted reply left');
      return { ...reply, toolCalls: [], modelUsed: 'cloud:test:model', failover: { attempted: 0, switchedTo: [] } };
    },
  };
});

import { callModel, trimToLastSentence } from '../paperModelCall';

beforeEach(() => {
  replies.length = 0;
  requests.length = 0;
});

describe('trimToLastSentence', () => {
  it('cuts back to the last complete sentence, keeping its citation', () => {
    expect(trimToLastSentence('The benefit held [S2]. A factorial trial would')).toBe('The benefit held [S2].');
    expect(trimToLastSentence('Benefit held [S2][S5]. Next one')).toBe('Benefit held [S2][S5].');
  });

  it('does not cut at a decimal point', () => {
    expect(trimToLastSentence('The ratio was 0.82 in one trial. The second trial reported 0.7')).toBe(
      'The ratio was 0.82 in one trial.',
    );
  });

  it('returns text with no sentence end as it is', () => {
    expect(trimToLastSentence('no full stop here')).toBe('no full stop here');
  });
});

describe('callModel on a section that reaches the output cap', () => {
  it('continues the section and joins it at a word boundary', async () => {
    replies.push(
      { content: 'The pooled estimate favoured treatment and the', finishReason: 'length' },
      { content: 'favoured treatment and the effect held across strata [S3].', finishReason: 'stop' },
    );
    const text = await callModel('cloud:test:model', 'system', 'user', 1000);
    expect(text).toBe('The pooled estimate favoured treatment and the effect held across strata [S3].');
    expect(requests[1]?.messages.at(-2)).toEqual({ role: 'assistant', content: 'The pooled estimate favoured treatment and the' });
  });

  it('trims to the last full sentence when it is still cut off', async () => {
    replies.push(
      { content: 'First claim [S1]. Second claim', finishReason: 'length' },
      { content: 'Second claim is still', finishReason: 'length' },
      { content: 'still going and', finishReason: 'length' },
    );
    expect(await callModel('cloud:test:model', 'system', 'user', 1000)).toBe('First claim [S1].');
  });

  it('keeps what was written when a continuation fails', async () => {
    replies.push({ content: 'First claim [S1]. Second claim', finishReason: 'length' });
    expect(await callModel('cloud:test:model', 'system', 'user', 1000, true)).toBe('First claim [S1].');
  });

  it('leaves a section that ended normally untouched', async () => {
    replies.push({ content: 'A complete section without a final stop', finishReason: 'stop' });
    expect(await callModel('cloud:test:model', 'system', 'user', 1000)).toBe('A complete section without a final stop');
  });
});
