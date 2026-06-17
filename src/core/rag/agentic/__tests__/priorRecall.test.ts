import { describe, expect, it } from 'vitest';
import { recallPriorBeliefs } from '../priorRecall';
import type { BeliefState } from '../types';

function belief(partial: Partial<BeliefState> & { id: string }): BeliefState {
  return {
    claimFingerprint: partial.id,
    representativeText: 'aspirin reduces myocardial infarction risk',
    beliefScore: 0.8,
    supportingChunks: ['c1'],
    conflictingChunks: [],
    revisionCount: 3,
    firstSeenAt: '2024-01-01',
    lastUpdatedAt: '2024-01-02',
    ...partial,
  };
}

describe('recallPriorBeliefs', () => {
  it('returns null with no beliefs or no hits', () => {
    expect(recallPriorBeliefs(['c1'], [])).toBeNull();
    expect(recallPriorBeliefs([], [belief({ id: 'b1' })])).toBeNull();
  });

  it('recalls a reinforced belief touching a retrieved chunk', () => {
    const note = recallPriorBeliefs(['c1'], [belief({ id: 'b1', revisionCount: 4, beliefScore: 0.85 })]);
    expect(note).toContain('Prior memory recalls');
    expect(note).toContain('corroborated');
    expect(note).toContain('85% confidence');
  });

  it('ignores single-observation beliefs (not yet learned)', () => {
    const note = recallPriorBeliefs(['c1'], [belief({ id: 'b1', revisionCount: 1 })]);
    expect(note).toBeNull();
  });

  it('flags a contested belief and orders it first', () => {
    const corroborated = belief({ id: 'b1', representativeText: 'X corroborated', supportingChunks: ['c1'], revisionCount: 5 });
    const contested = belief({ id: 'b2', representativeText: 'Y contested', supportingChunks: ['c2'], conflictingChunks: ['c1'], revisionCount: 3, beliefScore: 0.4 });
    const note = recallPriorBeliefs(['c1', 'c2'], [corroborated, contested])!;
    expect(note).toContain('CONTESTED');
    // Contested belief is mentioned before the corroborated one.
    expect(note.indexOf('Y contested')).toBeLessThan(note.indexOf('X corroborated'));
  });

  it('does not recall beliefs unrelated to the retrieved chunks', () => {
    const note = recallPriorBeliefs(['zzz'], [belief({ id: 'b1', supportingChunks: ['c1'] })]);
    expect(note).toBeNull();
  });
});
