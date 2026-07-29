import { describe, expect, it } from 'vitest';
import { applySwarmResult } from '../assistantMessage';
import type { ChatMessage } from '@core/store/chatHistoryStore';
import type { SwarmResult } from '../swarm/types';

const pending: ChatMessage = {
  id: 'a1',
  role: 'assistant',
  content: '',
  isStreaming: true,
};

function result(over: Partial<SwarmResult> = {}): SwarmResult {
  return {
    kind: 'research',
    answer: 'answer text',
    evidence: [],
    specialists: [],
    modelUsed: 'cloud:groq:llama-3.3-70b',
    ...over,
  };
}

describe('applySwarmResult', () => {
  it('closes out the streaming bubble', () => {
    const out = applySwarmResult(pending, result(), 'final text', []);
    expect(out.id).toBe('a1');
    expect(out.content).toBe('final text');
    expect(out.isStreaming).toBe(false);
  });

  // The badge is the only thing telling a reader that an answer was improvised
  // rather than researched — without it the two differ only by absent citation
  // chips, which nobody notices.
  it('marks a researched answer as evidence-grounded', () => {
    expect(applySwarmResult(pending, result({ kind: 'research' }), 'x', []).grounding).toBe('evidence');
  });

  it('marks a chat answer as conversational', () => {
    expect(applySwarmResult(pending, result({ kind: 'chat' }), 'x', []).grounding).toBe('conversational');
  });

  it('attaches citations only to a researched answer', () => {
    const evidence = Array.from({ length: 80 }, (_, i) => ({ title: `rec ${i}` })) as never;
    const research = applySwarmResult(pending, result({ kind: 'research', evidence }), 'x', []);
    expect(research.citations).toHaveLength(60);

    const chat = applySwarmResult(pending, result({ kind: 'chat', evidence }), 'x', []);
    expect(chat.citations).toBeUndefined();
  });

  // The reason this function exists. Both former copies had to grow this field
  // by hand, and the second one is where the next field gets forgotten.
  it('carries the manuscript and the per-gene association cards through', () => {
    const manuscript = { title: 'A paper' } as never;
    const associations = [{ gene: 'F5' }] as never;
    const out = applySwarmResult(pending, result({ manuscript, associations }), 'x', []);
    expect(out.manuscript).toBe(manuscript);
    expect(out.associations).toBe(associations);
  });

  // exactOptionalPropertyTypes is on: an absent optional must be absent, not
  // present-and-undefined, or a later `in` check reads it as set.
  it('omits optional fields entirely when the run produced none', () => {
    const out = applySwarmResult(pending, result(), 'x', []);
    expect('manuscript' in out).toBe(false);
    expect('associations' in out).toBe(false);
  });

  it('does not mutate the message it was given', () => {
    const before = { ...pending };
    applySwarmResult(pending, result(), 'changed', []);
    expect(pending).toEqual(before);
  });
});
