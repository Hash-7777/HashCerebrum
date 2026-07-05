import { describe, expect, it } from 'vitest';
import type { NliProvider } from '@core/rag/nli/workerClient';
import { verifyAnswer } from '../claimVerify';

// NLI mock: entailment score keyed by a substring of the hypothesis.
function providerFrom(scoreFor: (hypothesis: string) => number, ready = true): NliProvider {
  return {
    ready,
    warmup: async () => {},
    entailment: async (_premise, hypotheses) => hypotheses.map((h) => scoreFor(h)),
  };
}

const citations = [
  { snippet: 'Warfarin significantly increased major bleeding in the trial.' },
  { snippet: 'Aspirin reduced cardiovascular events among high-risk adults.' },
];

describe('verifyAnswer', () => {
  it('flags a cited sentence the source does not entail', async () => {
    const answer =
      'Warfarin raises bleeding risk [S1]. Warfarin also cures the common cold [S1].';
    const provider = providerFrom((h) => (/cold/i.test(h) ? 0.05 : 0.95));
    const result = await verifyAnswer(answer, citations, { provider });
    expect(result.checked).toBe(2);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toContain('common cold');
  });

  it('reports nothing unsupported when every claim is entailed', async () => {
    const answer = 'Aspirin lowers cardiovascular events [S2].';
    const provider = providerFrom(() => 0.9);
    const result = await verifyAnswer(answer, citations, { provider });
    expect(result).toEqual({ checked: 1, unsupported: [] });
  });

  it('ignores sentences with no citation', async () => {
    const answer = 'This sentence cites nothing at all.';
    const provider = providerFrom(() => 0.01);
    expect(await verifyAnswer(answer, citations, { provider })).toEqual({ checked: 0, unsupported: [] });
  });

  it('fails open when the model is not ready', async () => {
    const notReady = providerFrom(() => 0.01, false);
    const answer = 'Warfarin cures everything [S1].';
    expect(await verifyAnswer(answer, citations, { provider: notReady })).toEqual({
      checked: 0,
      unsupported: [],
    });
  });

  it('does not count an errored check', async () => {
    const throwing: NliProvider = {
      ready: true,
      warmup: async () => {},
      entailment: async () => {
        throw new Error('worker crashed');
      },
    };
    const answer = 'Warfarin cures everything [S1].';
    expect(await verifyAnswer(answer, citations, { provider: throwing })).toEqual({
      checked: 0,
      unsupported: [],
    });
  });
});
