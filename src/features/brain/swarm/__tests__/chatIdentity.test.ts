import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatTurnFacts, describeModel, identityAnswer } from '../boss';
import { earlierUserLines } from '../conversationBudget';
import { runRoutingGates, type GateContext } from '../routingGates';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import type { SwarmCallbacks } from '../types';
import type { LlmMessage } from '@core/llm/types';

beforeEach(() => {
  useModelCatalogStore.setState((state) => ({
    ...state,
    groups: [
      {
        provider: 'deepseek',
        label: 'DeepSeek',
        keyName: 'llm.deepseek',
        models: [{ value: 'cloud:deepseek:flash-model', label: 'Flash Model', shortLabel: 'Flash' }],
      },
    ],
  }));
});

describe('model identity', () => {
  it('names the model from the app catalog, with the provider it is reached through', () => {
    expect(describeModel('cloud:deepseek:flash-model')).toBe('Flash Model (DeepSeek)');
  });

  it('answers "what model are you" with the configured model, not a refusal', () => {
    const answer = identityAnswer('cloud:deepseek:flash-model');
    expect(answer).toContain('HashCerebrum');
    expect(answer).toContain('**Flash Model (DeepSeek)**');
    expect(answer).toContain('set for the boss in Settings');
  });

  it('the identity gate replies with the boss model it was given', async () => {
    const callbacks = { onBossPhase: vi.fn(), onAnswerToken: vi.fn() } as unknown as SwarmCallbacks;
    const ctx: GateContext = {
      question: 'what model are you',
      bossModel: 'cloud:deepseek:flash-model',
      callbacks,
      signal: undefined,
      bossContext: async () => [],
      priorWork: () => null,
    };
    const result = await runRoutingGates(ctx);
    expect(result?.answer).toContain('Flash Model (DeepSeek)');
  });

  it('tells the chat model which model is answering this turn', () => {
    expect(chatTurnFacts('cloud:deepseek:flash-model')).toContain('as recorded by the app: Flash Model (DeepSeek)');
  });
});

describe('earlier things the person said', () => {
  const turn = (role: 'user' | 'assistant', content: string): LlmMessage => ({ role, content });

  it('keeps a short line that fell outside the window, oldest first', () => {
    const conversation = [
      turn('user', 'hi'),
      turn('assistant', 'Hello.'),
      turn('user', 'my name is Rana'),
      turn('assistant', 'Nice to meet you.'),
      turn('user', 'keep it at bench level'),
      turn('assistant', 'Will do.'),
    ];
    const kept = conversation.slice(4);
    expect(earlierUserLines(conversation, kept)).toEqual(['hi', 'my name is Rana']);
  });

  it('leaves out long research questions and anything already in the window', () => {
    const long = 'x'.repeat(400);
    const conversation = [turn('user', long), turn('user', 'call me Dr Rana')];
    expect(earlierUserLines(conversation, [turn('user', 'call me Dr Rana')])).toEqual([]);
  });

  it('stops at its budget, keeping the newest lines', () => {
    const conversation = Array.from({ length: 30 }, (_, i) => turn('user', `line ${i} ${'y'.repeat(80)}`));
    const lines = earlierUserLines(conversation, [], { maxChars: 300 });
    expect(lines.length).toBeLessThan(30);
    expect(lines.at(-1)).toContain('line 29');
  });

  it('passes those lines to the chat model, marked as the person\'s own words', () => {
    const facts = chatTurnFacts('cloud:deepseek:flash-model', ['my name is Rana']);
    expect(facts).toContain('- my name is Rana');
    expect(facts).toContain('never invent anything they did not say');
  });
});
