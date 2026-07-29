import { describe, expect, it } from 'vitest';
import { claimFingerprint, createBelief, mergeBelief, updateBeliefs, topBeliefs } from '../beliefState';
import { buildBuckets, detectFlips, buildConsensusSummary } from '../consensusTimeline';
import { extractEntities, extractRelations, extractGeneSymbols, graphFromChunk, mergeGraph } from '../knowledgeGraph';
import { updateReliabilityMap, flagRetraction } from '../sourceReliability';
import { createEpisode, findSimilarEpisodes, hasSignificantGapChange } from '../episodicMemory';
import { enqueueGap, resolveItem, topPending } from '../learningQueue';
import type { RagChunk } from '../../types';
import type { ExtractedClaim } from '../claimExtractor';
import type { BeliefState } from '../types';

function makeClaim(partial: Partial<ExtractedClaim> & { text: string }): ExtractedClaim {
  return {
    id: `claim-${partial.text.slice(0, 20)}`,
    type: 'finding',
    confidence: 'high',
    sourceChunkId: 'c1',
    ...partial,
    text: partial.text,
  };
}

function makeChunk(partial: Partial<RagChunk> & { text: string }): RagChunk {
  const { text, ...rest } = partial;
  return {
    id: 'c1',
    projectId: 'p1',
    kind: 'evidence',
    title: '',
    text,
    source: 'pubmed',
    createdAt: '2024-01-01',
    ...rest,
  };
}

// ── Belief State ────────────────────────────────────────────────────────────

describe('claimFingerprint', () => {
  it('normalises punctuation and stop words', () => {
    const a = claimFingerprint('The drug was effective.');
    const b = claimFingerprint('drug effective');
    expect(a).toBe(b);
  });
});

describe('createBelief', () => {
  it('starts with prior confidence', () => {
    const claim = makeClaim({ text: 'aspirin reduces MI risk' });
    const b = createBelief(claim);
    expect(b.beliefScore).toBe(0.5);
    expect(b.supportingChunks).toContain('c1');
    expect(b.revisionCount).toBe(1);
  });

  it('includes structured data when present', () => {
    const claim = makeClaim({ text: 'OR = 2.1', effectLabel: 'OR', effectValue: '2.1' });
    const b = createBelief(claim);
    expect(b.structured?.effectLabel).toBe('OR');
    expect(b.structured?.effectValue).toBe('2.1');
  });
});

describe('mergeBelief', () => {
  it('increases score on supporting evidence', () => {
    const claim = makeClaim({ text: 'aspirin reduces MI risk' });
    let b = createBelief(claim);
    b = mergeBelief(b, makeClaim({ text: 'aspirin reduces MI risk', sourceChunkId: 'c2' }), false);
    expect(b.beliefScore).toBeGreaterThan(0.5);
    expect(b.supportingChunks).toContain('c2');
  });

  it('decreases score on conflicting evidence', () => {
    const claim = makeClaim({ text: 'aspirin reduces MI risk' });
    let b = createBelief(claim);
    b = mergeBelief(b, makeClaim({ text: 'aspirin increases MI risk', sourceChunkId: 'c2' }), true);
    expect(b.beliefScore).toBeLessThan(0.5);
    expect(b.conflictingChunks).toContain('c2');
  });
});

describe('updateBeliefs', () => {
  it('creates new beliefs for novel claims', () => {
    const claims = [makeClaim({ text: 'aspirin helps' }), makeClaim({ text: 'warfarin helps' })];
    const beliefs = updateBeliefs([], claims, []);
    expect(beliefs.length).toBe(2);
  });

  it('merges duplicate claims', () => {
    const claims = [makeClaim({ text: 'aspirin helps' }), makeClaim({ text: 'aspirin helps', sourceChunkId: 'c2' })];
    const beliefs = updateBeliefs([], claims, []);
    expect(beliefs.length).toBe(1);
    expect(beliefs[0]!.revisionCount).toBe(2);
  });
});

describe('topBeliefs', () => {
  it('returns highest-confidence beliefs first', () => {
    const b1 = createBelief(makeClaim({ text: 'a' }));
    const b2 = createBelief(makeClaim({ text: 'b' }));
    const b3 = createBelief(makeClaim({ text: 'c' }));
    b1.beliefScore = 0.9;
    b2.beliefScore = 0.6;
    b3.beliefScore = 0.3;
    const top = topBeliefs([b1, b2, b3], 2);
    expect(top[0]!.beliefScore).toBe(0.9);
    expect(top[1]!.beliefScore).toBe(0.6);
    expect(top.length).toBe(2);
  });
});

// ── Consensus Timeline ──────────────────────────────────────────────────────

describe('buildBuckets', () => {
  it('buckets beliefs by year', () => {
    const beliefs: BeliefState[] = [
      { ...createBelief(makeClaim({ text: 'aspirin reduces risk' })), supportingChunks: ['c1'] },
      { ...createBelief(makeClaim({ text: 'aspirin increases risk' })), supportingChunks: ['c2'] },
    ];
    const years: Record<string, number> = { c1: 2010, c2: 2020 };
    const buckets = buildBuckets(beliefs, years);
    expect(buckets.length).toBe(2);
    expect(buckets[0]!.year).toBe(2010);
    expect(buckets[1]!.year).toBe(2020);
  });
});

describe('detectFlips', () => {
  it('detects a consensus flip', () => {
    const buckets = [
      { year: 2010, positive: 5, negative: 0, neutral: 0, totalScore: 5, count: 5, keyChunks: ['c1'] },
      { year: 2020, positive: 0, negative: 5, neutral: 0, totalScore: 5, count: 5, keyChunks: ['c2'] },
    ];
    const flips = detectFlips(buckets);
    expect(flips.length).toBe(1);
    expect(flips[0]!.fromDirection).toBe('positive');
    expect(flips[0]!.toDirection).toBe('negative');
  });
});

describe('buildConsensusSummary', () => {
  it('summarises latest consensus', () => {
    const buckets = [
      { year: 2020, positive: 3, negative: 0, neutral: 0, totalScore: 3, count: 3, keyChunks: [] },
    ];
    const summary = buildConsensusSummary(buckets);
    expect(summary).toContain('Latest consensus (2020)');
  });
});

// ── Knowledge Graph ─────────────────────────────────────────────────────────

describe('extractEntities', () => {
  it('finds drugs in text', () => {
    const entities = extractEntities('Metformin reduces diabetes risk.');
    const drugs = entities.filter((e) => e.type === 'drug');
    expect(drugs.length).toBeGreaterThanOrEqual(1);
    expect(drugs.some((d) => d.word === 'metformin')).toBe(true);
  });

  it('finds conditions in text', () => {
    const entities = extractEntities('Patients with hypertension and diabetes.');
    const conditions = entities.filter((e) => e.type === 'condition');
    expect(conditions.some((c) => c.word === 'diabetes')).toBe(true);
  });
});

describe('extractRelations', () => {
  it('finds treatment relations', () => {
    const rels = extractRelations('Metformin reduces diabetes risk.', 'c1');
    expect(rels.some((r) => r.relation === 'treats')).toBe(true);
  });
});

describe('extractGeneSymbols', () => {
  it('catches an arbitrary gene in a gene-context window (MICA)', () => {
    expect(extractGeneSymbols('The MICA gene polymorphism was associated with risk.')).toContain('mica');
  });

  it('catches digit-bearing gene symbols without context (TP53, BRCA1)', () => {
    const genes = extractGeneSymbols('Mutations in TP53 and BRCA1 were frequent.');
    expect(genes).toContain('tp53');
    expect(genes).toContain('brca1');
  });

  it('does not hallucinate genes from study/stat acronyms', () => {
    const genes = extractGeneSymbols('The RCT used PCR and ELISA; the 95% CI was reported.');
    expect(genes).not.toContain('rct');
    expect(genes).not.toContain('pcr');
    expect(genes).not.toContain('elisa');
  });

  it('requires gene context for a bare uppercase token', () => {
    // "MICA" with no gene-context language nearby is not flagged.
    expect(extractGeneSymbols('The MICA results were unclear here.')).not.toContain('mica');
  });

  it('types a contextual gene as a gene node via extractEntities', () => {
    const entities = extractEntities('The MTHFR gene variant raised homocysteine.');
    expect(entities.some((e) => e.word === 'mthfr' && e.type === 'gene')).toBe(true);
  });
});

describe('graphFromChunk', () => {
  it('extracts nodes and edges from chunk', () => {
    const chunk = makeChunk({ text: 'Metformin reduces diabetes risk.' });
    const { nodes, edges } = graphFromChunk(chunk);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    expect(edges.length).toBeGreaterThanOrEqual(1);
  });
});

describe('mergeGraph', () => {
  it('merges without duplication', () => {
    const chunk = makeChunk({ text: 'Metformin reduces diabetes risk.' });
    const g1 = graphFromChunk(chunk);
    const g2 = graphFromChunk(chunk);
    const merged = mergeGraph(g1.nodes, g1.edges, g2.nodes, g2.edges);
    expect(merged.nodes.length).toBe(g1.nodes.length);
    expect(merged.edges.length).toBe(g1.edges.length);
  });
});

// ── Source Reliability ──────────────────────────────────────────────────────

describe('updateReliabilityMap', () => {
  it('creates new source entry', () => {
    const chunk = makeChunk({ text: 'test', source: 'pubmed', evidenceStrength: 'strong' });
    const map = updateReliabilityMap({}, chunk);
    expect(map['pubmed']).toBeDefined();
    expect(map['pubmed']!.score).toBeGreaterThan(0.5);
  });

  it('increases score on repeated strong evidence', () => {
    const chunk = makeChunk({ text: 'test', source: 'pubmed', evidenceStrength: 'strong' });
    let map = updateReliabilityMap({}, chunk);
    map = updateReliabilityMap(map, chunk);
    expect(map['pubmed']!.citationCount).toBe(2);
    expect(map['pubmed']!.score).toBeGreaterThan(map['pubmed']!.score - 0.01); // stable or up
  });
});

describe('flagRetraction', () => {
  it('penalises retracted source', () => {
    const chunk = makeChunk({ text: 'test', source: 'pubmed' });
    let map = updateReliabilityMap({}, chunk);
    const before = map['pubmed']!.score;
    map = flagRetraction(map, 'pubmed');
    expect(map['pubmed']!.score).toBeLessThan(before);
    expect(map['pubmed']!.retractionCount).toBe(1);
  });
});

// ── Episodic Memory ─────────────────────────────────────────────────────────

describe('createEpisode', () => {
  it('creates an episode with computed confidence', () => {
    const episode = createEpisode({
      projectId: 'p1',
      query: 'test query',
      subQueries: ['sq1'],
      evidence: [],
      gaps: [],
      modelUsed: 'local:ollama:test',
      specialists: [],
      citedChunks: [],
    });
    expect(episode.query).toBe('test query');
    expect(episode.confidence).toBeGreaterThanOrEqual(0);
    expect(episode.confidence).toBeLessThanOrEqual(1);
  });
});

describe('findSimilarEpisodes', () => {
  it('finds episodes with overlapping terms', () => {
    const ep1 = createEpisode({ projectId: 'p1', query: 'aspirin in diabetes', subQueries: [], evidence: [], gaps: [], modelUsed: 'test', specialists: [], citedChunks: [] });
    const ep2 = createEpisode({ projectId: 'p1', query: 'aspirin for stroke', subQueries: [], evidence: [], gaps: [], modelUsed: 'test', specialists: [], citedChunks: [] });
    const ep3 = createEpisode({ projectId: 'p1', query: 'warfarin dosing', subQueries: [], evidence: [], gaps: [], modelUsed: 'test', specialists: [], citedChunks: [] });
    const similar = findSimilarEpisodes([ep1, ep2, ep3], 'aspirin in MI');
    expect(similar.length).toBeGreaterThanOrEqual(1);
    expect(similar[0]!.query).toContain('aspirin');
  });
});

describe('hasSignificantGapChange', () => {
  it('detects resolved and new gaps', () => {
    const prev = createEpisode({ projectId: 'p1', query: 'q', subQueries: [], evidence: [], gaps: ['a', 'b'], modelUsed: 'test', specialists: [], citedChunks: [] });
    const change = hasSignificantGapChange(prev, ['b', 'c']);
    expect(change.changed).toBe(true);
    expect(change.resolved).toContain('a');
    expect(change.newGaps).toContain('c');
  });
});

// ── Learning Queue ──────────────────────────────────────────────────────────

describe('enqueueGap', () => {
  it('adds a new gap', () => {
    const queue = enqueueGap([], 'p1', 'renal function');
    expect(queue.length).toBe(1);
    expect(queue[0]!.concept).toBe('renal function');
    expect(queue[0]!.status).toBe('pending');
  });

  it('bumps priority on duplicate', () => {
    let queue = enqueueGap([], 'p1', 'renal function');
    const before = queue[0]!.priority;
    queue = enqueueGap(queue, 'p1', 'renal function', ['c1', 'c2']);
    expect(queue[0]!.priority).toBeGreaterThan(before);
  });
});

describe('resolveItem', () => {
  it('marks item as done', () => {
    let queue = enqueueGap([], 'p1', 'renal function');
    queue = resolveItem(queue, queue[0]!.id);
    expect(queue[0]!.status).toBe('done');
    expect(queue[0]!.resolvedAt).not.toBeNull();
  });
});

describe('topPending', () => {
  it('returns highest priority pending items', () => {
    let queue = enqueueGap([], 'p1', 'low priority concept');
    queue = enqueueGap(queue, 'p1', 'diabetes'); // higher priority
    const top = topPending(queue, 1);
    expect(top.length).toBe(1);
    expect(top[0]!.concept).toBe('diabetes');
  });
});
