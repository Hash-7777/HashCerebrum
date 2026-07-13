import { describe, expect, it, vi } from 'vitest';
import type { LlmMessage } from '@core/llm/types';
import { contextWindowTokens, estimateTokens, historyTokenBudget } from '../tokenBudget';
import { buildSummaryMessages, turnsToCompact, updateRunningSummary } from '../runningSummary';
import { assembleContext, buildPreamble } from '../assembleContext';

const u = (c: string): LlmMessage => ({ role: 'user', content: c });
const a = (c: string): LlmMessage => ({ role: 'assistant', content: c });

describe('tokenBudget', () => {
  it('estimates tokens and sizes a model window, defaulting small when unknown', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(contextWindowTokens('claude-opus-4-8')).toBe(200000);
    expect(contextWindowTokens('some-unknown-model')).toBe(8000);
  });

  it('reserves only a bounded share of the window for history', () => {
    expect(historyTokenBudget('claude-opus-4-8')).toBe(24000); // capped
    expect(historyTokenBudget('some-8k-model')).toBe(2000); // 25% of 8000
    expect(historyTokenBudget(undefined)).toBeGreaterThanOrEqual(1200); // floored
  });
});

describe('runningSummary', () => {
  it('selects only the turns older than the recent window to compact', () => {
    const convo = [u('1'), a('2'), u('3'), a('4'), u('5')];
    expect(turnsToCompact(convo, 2)).toEqual([u('1'), a('2'), u('3')]);
    expect(turnsToCompact(convo, 5)).toEqual([]);
  });

  it('folds evicted turns into the summary via the injected summariser', async () => {
    const summarise = vi.fn().mockResolvedValue('MTHFR C677T discussed; OR 1.6 for VTE.');
    const out = await updateRunningSummary('', [u('does C677T raise VTE risk'), a('yes, OR 1.6')], summarise);
    expect(out).toContain('MTHFR');
    expect(summarise).toHaveBeenCalledOnce();
    // prompt carries the prior summary slot and the new turns
    const sent = buildSummaryMessages('prev', [u('x')]);
    expect(sent[1]!.content).toContain('Existing summary:');
    expect(sent[1]!.content).toContain('USER: x');
  });

  it('keeps the prior summary when there is nothing to fold or the model fails', async () => {
    expect(await updateRunningSummary('keep', [], vi.fn())).toBe('keep');
    const boom = vi.fn().mockRejectedValue(new Error('no model'));
    expect(await updateRunningSummary('keep', [u('x')], boom)).toBe('keep');
  });
});

describe('assembleContext', () => {
  it('always keeps the recent window and prepends a memory preamble', () => {
    const out = assembleContext({
      pinned: 'user is a haematologist',
      summary: 'discussed MTHFR',
      recalled: [a('earlier: OR 1.6 for C677T')],
      recent: [u('what about F5?')],
      budgetTokens: 10000,
    });
    expect(out[0]!.role).toBe('system');
    expect(out[0]!.content).toContain('haematologist');
    expect(out[0]!.content).toContain('discussed MTHFR');
    expect(out[out.length - 1]).toEqual(u('what about F5?'));
  });

  it('drops recalled snippets before the summary when the budget is tight', () => {
    const out = assembleContext({
      summary: 'short summary',
      recalled: [a('x'.repeat(4000))],
      recent: [u('latest')],
      budgetTokens: 60, // only room for the recent turn + a tiny preamble
    });
    const preamble = out.find((m) => m.role === 'system');
    expect(preamble?.content).toContain('short summary');
    expect(preamble?.content ?? '').not.toContain('xxxx');
  });

  it('returns just the recent window when there is no memory to add', () => {
    const out = assembleContext({ recent: [u('hi')], budgetTokens: 1000 });
    expect(out).toEqual([u('hi')]);
  });

  it('buildPreamble is null when nothing to carry', () => {
    expect(buildPreamble(undefined, undefined, [])).toBeNull();
  });
});
