import { describe, expect, it } from 'vitest';
import { reinforceSources, reinforceBeliefs } from '../reinforcement';
import type { BeliefState, SourceReliability } from '../types';

function rel(source: string, score: number): SourceReliability {
  return { source, score, citationCount: 3, retractionCount: 0, avgEvidenceStrength: 0.6, lastUpdatedAt: '2024-01-01' };
}

function belief(partial: Partial<BeliefState> & { id: string }): BeliefState {
  return {
    claimFingerprint: partial.id,
    representativeText: 'claim',
    beliefScore: 0.7,
    supportingChunks: ['c1'],
    conflictingChunks: [],
    revisionCount: 3,
    firstSeenAt: '2024-01-01',
    lastUpdatedAt: '2024-01-01',
    ...partial,
  };
}

describe('reinforceSources', () => {
  it('penalises observed sources and rewards them back', () => {
    const map = { pubmed: rel('pubmed', 0.6) };
    const down = reinforceSources(map, ['pubmed'], 'penalty');
    expect(down['pubmed']!.score).toBeCloseTo(0.55, 5);
    const up = reinforceSources(down, ['pubmed'], 'reward');
    expect(up['pubmed']!.score).toBeCloseTo(0.6, 5);
  });

  it('ignores sources the agent has never observed', () => {
    const map = { pubmed: rel('pubmed', 0.6) };
    const out = reinforceSources(map, ['unknownsrc'], 'penalty');
    expect(out['unknownsrc']).toBeUndefined();
    expect(out['pubmed']!.score).toBe(0.6);
  });

  it('clamps within bounds', () => {
    const map = { junk: rel('junk', 0.06) };
    const out = reinforceSources(map, ['junk'], 'penalty');
    expect(out['junk']!.score).toBeGreaterThanOrEqual(0.05);
  });
});

describe('reinforceBeliefs', () => {
  it('decays a belief and forgets the pruned chunk on penalty', () => {
    const beliefs = [belief({ id: 'b1', supportingChunks: ['c1', 'c2'], beliefScore: 0.7 })];
    const out = reinforceBeliefs(beliefs, ['c1'], 'penalty');
    expect(out[0]!.beliefScore).toBeCloseTo(0.64, 5);
    expect(out[0]!.supportingChunks).toEqual(['c2']);
    expect(out[0]!.revisionCount).toBe(4);
  });

  it('drops a belief that loses all of its evidence', () => {
    const beliefs = [belief({ id: 'b1', supportingChunks: ['c1'], conflictingChunks: [] })];
    const out = reinforceBeliefs(beliefs, ['c1'], 'penalty');
    expect(out.length).toBe(0);
  });

  it('reinforces and keeps references on reward', () => {
    const beliefs = [belief({ id: 'b1', supportingChunks: ['c1'], beliefScore: 0.7 })];
    const out = reinforceBeliefs(beliefs, ['c1'], 'reward');
    expect(out[0]!.beliefScore).toBeCloseTo(0.76, 5);
    expect(out[0]!.supportingChunks).toEqual(['c1']);
  });

  it('leaves untouched beliefs alone', () => {
    const beliefs = [belief({ id: 'b1', supportingChunks: ['c9'] })];
    const out = reinforceBeliefs(beliefs, ['c1'], 'penalty');
    expect(out[0]).toBe(beliefs[0]);
  });

  it('updates references but not score when only a conflicting chunk is curated', () => {
    const beliefs = [belief({ id: 'b1', supportingChunks: ['c1'], conflictingChunks: ['c2'], beliefScore: 0.4 })];
    const out = reinforceBeliefs(beliefs, ['c2'], 'penalty');
    expect(out[0]!.beliefScore).toBe(0.4);
    expect(out[0]!.conflictingChunks).toEqual([]);
  });
});
