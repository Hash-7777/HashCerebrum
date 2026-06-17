import { describe, expect, it } from 'vitest';
import { applyLearnedPriors, makePriorScorer, type LearnedState } from '../learnedPriors';
import { createBelief } from '../beliefState';
import type { RagChunk, RagSearchHit } from '../../types';
import type { KnowledgeGraphNode, SourceReliability } from '../types';

function chunk(partial: Partial<RagChunk> & { id: string }): RagChunk {
  return {
    projectId: 'p1',
    kind: 'evidence',
    title: '',
    text: 'x',
    source: 'pubmed',
    createdAt: '2024-01-01',
    ...partial,
  };
}

function hit(c: RagChunk, score: number): RagSearchHit {
  return { chunk: c, score };
}

function reliability(source: string, score: number): SourceReliability {
  return {
    source,
    score,
    citationCount: 1,
    retractionCount: 0,
    avgEvidenceStrength: 0.5,
    lastUpdatedAt: '2024-01-01',
  };
}

function emptyState(): LearnedState {
  return { beliefs: [], sourceReliability: {}, graphNodes: [] };
}

describe('makePriorScorer', () => {
  it('is neutral (1.0) for an unseen source with no beliefs or graph', () => {
    const scorer = makePriorScorer(emptyState());
    expect(scorer.boostFor(chunk({ id: 'c1' }))).toBeCloseTo(1.0, 5);
  });

  it('boosts a chunk from a highly-reliable learned source', () => {
    const scorer = makePriorScorer({ ...emptyState(), sourceReliability: { pubmed: reliability('pubmed', 1.0) } });
    expect(scorer.boostFor(chunk({ id: 'c1', source: 'pubmed' }))).toBeGreaterThan(1.0);
  });

  it('demotes a chunk from a low-reliability learned source', () => {
    const scorer = makePriorScorer({ ...emptyState(), sourceReliability: { junk: reliability('junk', 0.0) } });
    expect(scorer.boostFor(chunk({ id: 'c1', source: 'junk' }))).toBeLessThan(1.0);
  });

  it('lifts a chunk that supports a high-confidence belief', () => {
    const belief = { ...createBelief({ id: 'b', text: 'aspirin reduces MI risk', type: 'finding', confidence: 'high', sourceChunkId: 'c1' }), beliefScore: 0.95, supportingChunks: ['c1'] };
    const scorer = makePriorScorer({ ...emptyState(), beliefs: [belief] });
    expect(scorer.boostFor(chunk({ id: 'c1' }))).toBeGreaterThan(scorer.boostFor(chunk({ id: 'other' })));
  });

  it('does not demote a chunk that merely conflicts with a belief', () => {
    const belief = { ...createBelief({ id: 'b', text: 'aspirin reduces MI risk', type: 'finding', confidence: 'high', sourceChunkId: 'c1' }), beliefScore: 0.95, supportingChunks: ['c1'], conflictingChunks: ['c2'] };
    const scorer = makePriorScorer({ ...emptyState(), beliefs: [belief] });
    // c2 only conflicts → treated neutrally, never penalised.
    expect(scorer.boostFor(chunk({ id: 'c2' }))).toBeCloseTo(1.0, 5);
  });

  it('rewards knowledge-graph centrality, capped', () => {
    const node = (id: string, chunks: string[]): KnowledgeGraphNode => ({
      id, type: 'drug', label: id, aliases: [], confidence: 1, supportingChunks: chunks, firstSeenAt: '', lastUpdatedAt: '',
    });
    const nodes = Array.from({ length: 20 }, (_, i) => node(`n${i}`, ['c1']));
    const scorer = makePriorScorer({ ...emptyState(), graphNodes: nodes });
    const boost = scorer.boostFor(chunk({ id: 'c1' }));
    expect(boost).toBeGreaterThan(1.0);
    expect(boost).toBeLessThanOrEqual(1.05 + 1e-9); // capped at GRAPH_MAX_NODES * GRAPH_PER_NODE
  });

  it('clamps the combined multiplier within bounds', () => {
    const belief = { ...createBelief({ id: 'b', text: 't', type: 'finding', confidence: 'high', sourceChunkId: 'c1' }), beliefScore: 0.95, supportingChunks: ['c1'] };
    const scorer = makePriorScorer({
      beliefs: [belief],
      sourceReliability: { pubmed: reliability('pubmed', 1.0) },
      graphNodes: [{ id: 'n', type: 'drug', label: 'n', aliases: [], confidence: 1, supportingChunks: ['c1'], firstSeenAt: '', lastUpdatedAt: '' }],
    });
    const boost = scorer.boostFor(chunk({ id: 'c1', source: 'pubmed' }));
    expect(boost).toBeGreaterThanOrEqual(0.85);
    expect(boost).toBeLessThanOrEqual(1.25);
  });
});

describe('applyLearnedPriors', () => {
  it('returns hits unchanged when the store is cold', () => {
    const hits = [hit(chunk({ id: 'c1' }), 0.5), hit(chunk({ id: 'c2' }), 0.4)];
    const out = applyLearnedPriors(hits, emptyState());
    expect(out.map((h) => h.chunk.id)).toEqual(['c1', 'c2']);
  });

  it('re-orders a near-tie in favour of the learned-reliable source', () => {
    const a = hit(chunk({ id: 'a', source: 'lowtrust' }), 0.50);
    const b = hit(chunk({ id: 'b', source: 'hightrust' }), 0.48);
    const state: LearnedState = {
      beliefs: [],
      graphNodes: [],
      sourceReliability: { lowtrust: reliability('lowtrust', 0.1), hightrust: reliability('hightrust', 1.0) },
    };
    const out = applyLearnedPriors([a, b], state);
    expect(out[0]!.chunk.id).toBe('b');
  });
});
