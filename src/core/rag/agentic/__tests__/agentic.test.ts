import { describe, expect, it } from 'vitest';
import { deterministicPlan, planQuery } from '../queryPlanner';
import { assessCoverage, conceptGroups, coreConceptGroups } from '../coverageAssessor';
import { extractClaims } from '../claimExtractor';
import { detectConflicts } from '../conflictDetector';
import { traverseCitations } from '../citationTraverser';
import type { RagChunk } from '../../types';

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

// ── Query Planner ───────────────────────────────────────────────────────────

describe('deterministicPlan', () => {
  it('returns sub-queries for a biomedical question', () => {
    const plan = deterministicPlan('statin therapy for diabetes prevention');
    expect(plan.subQueries.length).toBeGreaterThanOrEqual(1);
    expect(plan.subQueries.length).toBeLessThanOrEqual(4);
    expect(plan.concepts.length).toBeGreaterThanOrEqual(1);
    expect(plan.reasoning).toContain('deterministic');
  });

  it('falls back to generic sub-queries for very short queries', () => {
    const plan = deterministicPlan('x');
    expect(plan.subQueries).toContain('x');
    expect(plan.subQueries.some((sq) => sq.includes('mechanism'))).toBe(true);
  });
});

describe('planQuery', () => {
  it('falls back to deterministic plan when no model is given', async () => {
    const plan = await planQuery('aspirin in MI', undefined);
    expect(plan.subQueries.length).toBeGreaterThanOrEqual(1);
    expect(plan.reasoning).toContain('deterministic');
  });

  it('falls back on empty query', async () => {
    const plan = await planQuery('', 'local:ollama:test');
    expect(plan.subQueries.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Coverage Assessor ───────────────────────────────────────────────────────

describe('conceptGroups', () => {
  it('extracts significant terms and expands synonyms', () => {
    const groups = conceptGroups('renal function in diabetes');
    const terms = groups.map((g) => g[0]);
    expect(terms).toContain('renal');
    expect(terms).toContain('diabetes');
    // renal should have kidney synonym
    const renalGroup = groups.find((g) => g[0] === 'renal');
    expect(renalGroup).toBeDefined();
    expect(renalGroup!.slice(1)).toContain('kidney');
  });

  it('filters filler words', () => {
    const groups = conceptGroups('what is the effect of treatment on patients');
    const terms = groups.map((g) => g[0]);
    expect(terms).not.toContain('effect');
    expect(terms).not.toContain('treatment');
    expect(terms).not.toContain('patients');
  });
});

describe('coreConceptGroups', () => {
  it('excludes generic terms like effect and impact', () => {
    const groups = coreConceptGroups('effect of warfarin on stroke risk');
    const terms = groups.map((g) => g[0]);
    expect(terms).toContain('warfarin');
    expect(terms).toContain('stroke');
    expect(terms).not.toContain('effect');
  });
});

describe('assessCoverage', () => {
  it('returns full coverage when all concepts are present', () => {
    const chunks = [
      makeChunk({ text: 'statin therapy reduces cardiovascular events in diabetic patients.' }),
    ];
    const assessment = assessCoverage('statin therapy for diabetes', chunks);
    expect(assessment.coveredConcepts).toBeGreaterThanOrEqual(1);
    expect(assessment.coverageScore).toBeGreaterThanOrEqual(0);
    expect(assessment.coverageScore).toBeLessThanOrEqual(1);
  });

  it('flags missing concepts', () => {
    const chunks = [makeChunk({ text: 'aspirin reduces platelet aggregation.' })];
    const assessment = assessCoverage('warfarin anticoagulation in atrial fibrillation', chunks);
    expect(assessment.missingConcepts.length).toBeGreaterThanOrEqual(1);
    expect(assessment.gapNote).toContain('lack');
  });

  it('handles empty chunks', () => {
    const assessment = assessCoverage('some query', []);
    expect(assessment.needsReRetrieve).toBe(true);
    expect(assessment.gapNote).toBeTruthy();
  });
});

// ── Claim Extractor ─────────────────────────────────────────────────────────

describe('extractClaims', () => {
  it('extracts effect-size claims with high confidence', () => {
    const chunk = makeChunk({
      text: 'The odds ratio was 2 (95% CI 1 to 3, p less than 0.001).',
    });
    const claims = extractClaims(chunk);
    expect(claims.length).toBeGreaterThanOrEqual(1);
    const effectClaim = claims.find((c) => c.type === 'effect_size');
    expect(effectClaim).toBeDefined();
    expect(effectClaim!.confidence).toBe('high');
  });

  it('extracts sample-size claims', () => {
    const chunk = makeChunk({
      text: 'A total of 4,532 patients were enrolled.',
    });
    const claims = extractClaims(chunk);
    const sampleClaim = claims.find((c) => c.type === 'sample_size');
    expect(sampleClaim).toBeDefined();
    expect(sampleClaim!.sampleSize).toBe(4532);
  });

  it('extracts limitation claims', () => {
    const chunk = makeChunk({
      text: 'The main limitation was the retrospective design.',
    });
    const claims = extractClaims(chunk);
    const limClaim = claims.find((c) => c.type === 'limitation');
    expect(limClaim).toBeDefined();
  });

  it('skips very short sentences', () => {
    const chunk = makeChunk({ text: 'Yes. No. OK.' });
    const claims = extractClaims(chunk);
    expect(claims.length).toBe(0);
  });
});

// ── Conflict Detector ───────────────────────────────────────────────────────

describe('detectConflicts', () => {
  it('detects directional conflicts between different chunks', () => {
    const claims = [
      { id: 'a1', text: 'Statin therapy increased mortality.', type: 'finding' as const, confidence: 'high' as const, sourceChunkId: 'c1' },
      { id: 'a2', text: 'Statin therapy decreased mortality.', type: 'finding' as const, confidence: 'high' as const, sourceChunkId: 'c2' },
    ];
    const conflicts = detectConflicts(claims);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts[0]!.type).toBe('directional');
  });

  it('ignores conflicts within the same chunk', () => {
    const claims = [
      { id: 'a1', text: 'Drug A increased blood pressure.', type: 'finding' as const, confidence: 'high' as const, sourceChunkId: 'c1' },
      { id: 'a2', text: 'Drug A decreased blood pressure.', type: 'finding' as const, confidence: 'high' as const, sourceChunkId: 'c1' },
    ];
    const conflicts = detectConflicts(claims);
    expect(conflicts.length).toBe(0);
  });

  it('detects effectiveness conflicts', () => {
    const claims = [
      { id: 'a1', text: 'The treatment showed significant benefit.', type: 'finding' as const, confidence: 'high' as const, sourceChunkId: 'c1' },
      { id: 'a2', text: 'The treatment was not effective.', type: 'finding' as const, confidence: 'high' as const, sourceChunkId: 'c2' },
    ];
    const conflicts = detectConflicts(claims);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts[0]!.type).toBe('effectiveness');
  });

  it('returns empty when no conflicts exist', () => {
    const claims = [
      { id: 'a1', text: 'The drug showed benefit.', type: 'finding' as const, confidence: 'high' as const, sourceChunkId: 'c1' },
      { id: 'a2', text: 'Long-term follow-up confirmed benefit.', type: 'finding' as const, confidence: 'high' as const, sourceChunkId: 'c2' },
    ];
    const conflicts = detectConflicts(claims);
    expect(conflicts.length).toBe(0);
  });
});

// ── Citation Traverser ──────────────────────────────────────────────────────

describe('traverseCitations', () => {
  it('resolves a DOI citation to a matching chunk', () => {
    const chunks = [
      makeChunk({ id: 'c1', text: 'See also doi.org/10.1234/example for details.' }),
      makeChunk({ id: 'c2', doi: '10.1234/example', text: 'The referenced paper.' }),
    ];
    const result = traverseCitations(chunks, chunks);
    expect(result.references.length).toBeGreaterThanOrEqual(1);
    expect(result.resolvedHits.length).toBe(1);
    expect(result.resolvedHits[0]!.chunk.id).toBe('c2');
  });

  it('resolves a PMID citation', () => {
    const chunks = [
      makeChunk({ id: 'c1', text: 'As reported in PMID 12345678.' }),
      makeChunk({ id: 'c2', pmid: '12345678', text: 'The cited study.' }),
    ];
    const result = traverseCitations(chunks, chunks);
    expect(result.resolvedHits.length).toBe(1);
    expect(result.resolvedHits[0]!.chunk.id).toBe('c2');
  });

  it('does not resolve self-references', () => {
    const chunks = [
      makeChunk({ id: 'c1', pmid: '12345678', text: 'This study (PMID 12345678) shows...' }),
    ];
    const result = traverseCitations(chunks, chunks);
    expect(result.resolvedHits.length).toBe(0);
    // Self-references are extracted but not resolved, so they appear as unresolved
    expect(result.unresolved.length).toBe(1);
  });

  it('returns empty for chunks with no citations', () => {
    const chunks = [makeChunk({ id: 'c1', text: 'No citations here.' })];
    const result = traverseCitations(chunks, chunks);
    expect(result.references.length).toBe(0);
    expect(result.resolvedHits.length).toBe(0);
  });
});
