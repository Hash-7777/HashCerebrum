import { describe, expect, it } from 'vitest';
import { budgetConversation } from '../conversationBudget';
import type { LlmMessage } from '@core/llm/types';

const u = (content: string): LlmMessage => ({ role: 'user', content });
const a = (content: string): LlmMessage => ({ role: 'assistant', content });

describe('budgetConversation', () => {
  it('keeps a short conversation intact and in order', () => {
    const convo = [u('hi'), a('hello'), u('what is metformin')];
    expect(budgetConversation(convo, { maxChars: 1000 })).toEqual(convo);
  });

  it('head-truncates a long assistant answer rather than replaying the whole paper', () => {
    const paper = 'ABSTRACT '.repeat(1000); // ~9000 chars
    const out = budgetConversation([u('write a paper'), a(paper)], {
      maxChars: 20000,
      perAssistantChars: 500,
    });
    const assistant = out.find((m) => m.role === 'assistant')!;
    expect(assistant.content.length).toBeLessThanOrEqual(500);
    expect(assistant.content).toMatch(/truncated/);
  });

  it('drops the oldest turns once the character budget is spent, newest kept', () => {
    const convo = [u('oldest'), a('x'.repeat(300)), u('middle'), a('y'.repeat(300)), u('newest')];
    const out = budgetConversation(convo, { maxChars: 350, perAssistantChars: 1000 });
    expect(out[out.length - 1]).toEqual(u('newest'));
    expect(out.find((m) => m.content === 'oldest')).toBeUndefined();
  });

  it('always keeps the latest turn even if it alone exceeds the budget', () => {
    const out = budgetConversation([u('old'), u('z'.repeat(5000))], { maxChars: 100 });
    expect(out).toHaveLength(1);
    expect(out[0]!.content.length).toBe(5000);
  });

  it('honours a hard turn cap, newest-first', () => {
    const convo = [u('1'), u('2'), u('3'), u('4'), u('5')];
    const out = budgetConversation(convo, { maxChars: 100000, maxTurns: 2 });
    expect(out).toEqual([u('4'), u('5')]);
  });
});
