import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RagChunk, RagSearchHit } from '../../types';

// Mock the two stores the orchestrator reaches into, so we can drive retrieval
// deterministically and observe the agentic gap-filling round.
const searchHybrid = vi.fn();
vi.mock('../../store/ragStore', () => ({
  useRagStore: { getState: () => ({ searchHybrid }) },
}));

const learningState = {
  beliefs: [] as unknown[],
  graphNodes: [] as unknown[],
  graphEdges: [] as unknown[],
  sourceReliability: {} as Record<string, unknown>,
  learningQueue: [] as unknown[],
  setBeliefs: vi.fn(),
  setGraph: vi.fn(),
  setSourceReliability: vi.fn(),
  setLearningQueue: vi.fn(),
};
vi.mock('../learningStore', () => ({
  useLearningStore: { getState: () => learningState },
}));

import { smartRetrieve } from '../smartRagOrchestrator';

function chunk(id: string, text: string, year?: number): RagChunk {
  return { id, projectId: 'p1', kind: 'evidence', title: '', text, source: 'pubmed', createdAt: '2024-01-01', ...(year ? { year } : {}) };
}

function hit(c: RagChunk): RagSearchHit {
  return { chunk: c, score: 0.5 };
}

beforeEach(() => {
  searchHybrid.mockReset();
  learningState.beliefs = [];
});

describe('smartRetrieve gap-filling round', () => {
  it('fires a re-retrieval round when a core concept is uncovered, and reports it', async () => {
    // First-round searches only ever return an aspirin chunk; warfarin stays
    // uncovered until the gap round explicitly asks for it.
    searchHybrid.mockImplementation(async (_p: string, q: string) => {
      if (/warfarin/i.test(q)) return [hit(chunk('w1', 'warfarin anticoagulation increases bleeding risk'))];
      return [hit(chunk('a1', 'aspirin reduces platelet aggregation'))];
    });

    const result = await smartRetrieve('aspirin warfarin interaction bleeding', {
      activeProjectId: 'p1',
      limit: 8,
    });

    expect(result.reRetrieved).toBe(true);
    // The warfarin chunk only reachable via the gap round made it into the set.
    expect(result.hits.some((h) => h.chunk.id === 'w1')).toBe(true);
    expect(result.gapNote).toContain('gap-filling');
  });

  it('does not re-retrieve when coverage is already good', async () => {
    // Every search returns a chunk covering all concepts at once.
    searchHybrid.mockResolvedValue([
      hit(chunk('c1', 'aspirin and warfarin interaction raises bleeding risk substantially')),
    ]);

    const result = await smartRetrieve('aspirin warfarin interaction bleeding', {
      activeProjectId: 'p1',
      limit: 8,
    });

    expect(result.reRetrieved).toBe(false);
  });
});

describe('smartRetrieve consensus-over-time note', () => {
  it('reports how consensus shifted across years', async () => {
    learningState.beliefs = [
      {
        id: 'b1', claimFingerprint: 'b1', representativeText: 'aspirin improved outcomes with lower risk',
        beliefScore: 0.8, supportingChunks: ['p2010'], conflictingChunks: [], revisionCount: 3,
        firstSeenAt: '', lastUpdatedAt: '',
      },
      {
        id: 'b2', claimFingerprint: 'b2', representativeText: 'aspirin increased risk with no benefit',
        beliefScore: 0.8, supportingChunks: ['p2020'], conflictingChunks: [], revisionCount: 3,
        firstSeenAt: '', lastUpdatedAt: '',
      },
    ];
    searchHybrid.mockResolvedValue([
      hit(chunk('p2010', 'aspirin primary prevention improved outcomes lower risk', 2010)),
      hit(chunk('p2020', 'aspirin primary prevention increased risk no benefit', 2020)),
    ]);

    const result = await smartRetrieve('aspirin primary prevention', { activeProjectId: 'p1', limit: 8 });

    expect(result.consensusNote).toBeTruthy();
    expect(result.consensusNote).toContain('consensus');
  });

  it('returns no consensus note without multi-year data', async () => {
    searchHybrid.mockResolvedValue([hit(chunk('c1', 'aspirin primary prevention benefit'))]);
    const result = await smartRetrieve('aspirin primary prevention', { activeProjectId: 'p1', limit: 8 });
    expect(result.consensusNote).toBeNull();
  });
});
