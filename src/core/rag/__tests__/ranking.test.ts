import { describe, expect, it } from 'vitest';
import {
  classifyEvidenceStrength,
  evidenceStrengthWeight,
  medicalBoost,
  mmrRerank,
  recencyWeight,
  trustWeight,
} from '../search/ranking';
import type { RagChunk, RagSearchHit } from '../types';

function chunk(partial: Partial<RagChunk>): RagChunk {
  return {
    id: 'x',
    projectId: 'p',
    kind: 'evidence',
    title: '',
    text: '',
    source: 'pubmed',
    createdAt: '2024-01-01',
    ...partial,
  };
}

describe('evidence-strength weighting', () => {
  it('ranks stronger designs higher and unknown as neutral', () => {
    expect(evidenceStrengthWeight('strong')).toBeGreaterThan(evidenceStrengthWeight('moderate'));
    expect(evidenceStrengthWeight('moderate')).toBeGreaterThan(evidenceStrengthWeight('weak'));
    expect(evidenceStrengthWeight('context')).toBeLessThan(1);
    expect(evidenceStrengthWeight(undefined)).toBe(1);
  });
});

describe('recencyWeight', () => {
  it('mildly prefers recent and demotes very old, neutral when unknown', () => {
    expect(recencyWeight(2024, 2026)).toBeGreaterThan(1);
    expect(recencyWeight(2005, 2026)).toBeLessThan(1);
    expect(recencyWeight(undefined, 2026)).toBe(1);
    expect(recencyWeight('2024', 2026)).toBeGreaterThan(1);
  });
});

describe('trustWeight', () => {
  it('ranks peer-reviewed sources above drug-label sources and answers', () => {
    expect(trustWeight(chunk({ source: 'pubmed' }))).toBeGreaterThan(trustWeight(chunk({ source: 'rxnorm' })));
    expect(trustWeight(chunk({ source: 'pubmed' }))).toBeGreaterThan(trustWeight(chunk({ source: 'answer' })));
    // A resolvable identifier raises trust; PMID outranks DOI.
    expect(trustWeight(chunk({ source: 'pubmed', pmid: '123' }))).toBeGreaterThan(trustWeight(chunk({ source: 'pubmed' })));
    expect(trustWeight(chunk({ source: 'pubmed', pmid: '123' }))).toBeGreaterThan(trustWeight(chunk({ source: 'pubmed', doi: '10.x' })));
    // Unknown source stays neutral.
    expect(trustWeight(chunk({ source: 'mystery' }))).toBe(1);
  });
});

describe('medicalBoost', () => {
  it('combines strength, recency, and source trust', () => {
    const strongRecent = medicalBoost(chunk({ evidenceStrength: 'strong', year: 2025 }), 2026);
    const weakOld = medicalBoost(chunk({ evidenceStrength: 'weak', year: 2004 }), 2026);
    expect(strongRecent).toBeGreaterThan(weakOld);
    // Neutral metadata on an unknown source is a true no-op.
    expect(medicalBoost(chunk({ source: 'mystery' }), 2026)).toBe(1);
    // A trusted, verifiable source lifts an otherwise-neutral chunk.
    expect(medicalBoost(chunk({ source: 'pubmed', pmid: '1' }), 2026)).toBeGreaterThan(1);
  });
});

describe('classifyEvidenceStrength', () => {
  it('grades by study design keywords and source', () => {
    expect(classifyEvidenceStrength('A systematic review and meta-analysis of RCTs', 'pubmed')).toBe('strong');
    expect(classifyEvidenceStrength('a prospective cohort study', 'pubmed')).toBe('moderate');
    expect(classifyEvidenceStrength('a single case report', 'pubmed')).toBe('weak');
    expect(classifyEvidenceStrength('drug label', 'openfda')).toBe('context');
    expect(classifyEvidenceStrength('general discussion of a topic', 'pubmed')).toBeUndefined();
  });
});

describe('mmrRerank', () => {
  it('demotes a near-duplicate of an already-selected hit', () => {
    const hits: RagSearchHit[] = [
      { chunk: chunk({ id: 'a' }), score: 1.0 },
      { chunk: chunk({ id: 'a-dup' }), score: 0.98 }, // nearly identical to a
      { chunk: chunk({ id: 'b' }), score: 0.9 }, // distinct topic
    ];
    const vectors: Record<string, Float32Array> = {
      a: Float32Array.from([1, 0]),
      'a-dup': Float32Array.from([0.99, 0.01]),
      b: Float32Array.from([0, 1]),
    };
    const out = mmrRerank(hits, (id) => vectors[id], 0.7, 2);
    expect(out[0]!.chunk.id).toBe('a');
    // The distinct 'b' should be picked over the near-duplicate 'a-dup'.
    expect(out[1]!.chunk.id).toBe('b');
  });
});
