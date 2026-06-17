import { describe, expect, it } from 'vitest';
import { reasoningRerank, conflictedChunkIds } from '../reasoningRerank';
import { recallAtK, reciprocalRank, ndcgAtK } from '../../search/evalMetrics';
import type { ExtractedClaim } from '../claimExtractor';
import type { RagChunk, RagSearchHit } from '../../types';

function chunk(id: string, source = 'pubmed'): RagChunk {
  return { id, projectId: 'p1', kind: 'evidence', title: '', text: '', source, createdAt: '2024-01-01' };
}

function hit(id: string, score: number, source = 'pubmed'): RagSearchHit {
  return { chunk: chunk(id, source), score };
}

function claim(chunkId: string, confidence: ExtractedClaim['confidence']): ExtractedClaim {
  return { id: `${chunkId}-${confidence}-${Math.random()}`, text: 't', type: 'finding', confidence, sourceChunkId: chunkId };
}

describe('conflictedChunkIds', () => {
  it('maps conflicting claim ids back to their chunks', () => {
    const claims: ExtractedClaim[] = [
      { id: 'a1', text: 'x', type: 'finding', confidence: 'high', sourceChunkId: 'c1' },
      { id: 'a2', text: 'y', type: 'finding', confidence: 'high', sourceChunkId: 'c2' },
    ];
    const ids = conflictedChunkIds(claims, [{ claimA: 'a1', claimB: 'a2' }]);
    expect([...ids].sort()).toEqual(['c1', 'c2']);
  });
});

describe('reasoningRerank', () => {
  it('is a no-op for 0 or 1 hits', () => {
    expect(reasoningRerank([], { claims: [], conflictedChunkIds: new Set() })).toEqual([]);
    const one = [hit('c1', 0.5)];
    expect(reasoningRerank(one, { claims: [], conflictedChunkIds: new Set() })).toEqual(one);
  });

  it('promotes an evidence-dense near-tie above a thin one', () => {
    // c2 starts marginally behind c1 but carries several high-confidence claims.
    const hits = [hit('c1', 0.50), hit('c2', 0.47)];
    const claims = [claim('c2', 'high'), claim('c2', 'high'), claim('c2', 'high')];
    const out = reasoningRerank(hits, { claims, conflictedChunkIds: new Set() });
    expect(out[0]!.chunk.id).toBe('c2');
  });

  it('surfaces a conflicted chunk among equals', () => {
    const hits = [hit('c1', 0.50), hit('c2', 0.50)];
    const out = reasoningRerank(hits, { claims: [], conflictedChunkIds: new Set(['c2']) });
    expect(out[0]!.chunk.id).toBe('c2');
  });

  it('breaks up a run of one source via the diversity penalty', () => {
    const hits = [hit('a1', 0.50, 'pubmed'), hit('a2', 0.49, 'pubmed'), hit('b1', 0.48, 'europepmc')];
    const out = reasoningRerank(hits, { claims: [], conflictedChunkIds: new Set(), diversityWeight: 0.6 });
    // The second pick should switch source rather than stack a third pubmed.
    expect(out[1]!.chunk.source).toBe('europepmc');
  });

  it('measurably improves ranking metrics on a labelled scenario', () => {
    // Ground truth: the two evidence-dense chunks (c3, c5) are the relevant ones,
    // but base retrieval ranks them 3rd and 5th.
    const relevant = new Set(['c3', 'c5']);
    const hits = [hit('c1', 0.60), hit('c2', 0.58), hit('c3', 0.56), hit('c4', 0.54), hit('c5', 0.52)];
    const claims = [
      claim('c3', 'high'), claim('c3', 'high'), claim('c3', 'high'),
      claim('c5', 'high'), claim('c5', 'high'), claim('c5', 'medium'),
    ];

    const before = hits.map((h) => h.chunk.id);
    const after = reasoningRerank(hits, { claims, conflictedChunkIds: new Set() }).map((h) => h.chunk.id);

    expect(recallAtK(after, relevant, 2)).toBeGreaterThan(recallAtK(before, relevant, 2));
    expect(reciprocalRank(after, relevant)).toBeGreaterThan(reciprocalRank(before, relevant));
    expect(ndcgAtK(after, relevant, 5)).toBeGreaterThan(ndcgAtK(before, relevant, 5));
  });
});
