import { describe, expect, it, vi } from 'vitest';
import { runStudyPass, evidenceToChunks, STUDY_TAG } from '../studyEngine';
import type { EvidenceItem } from '@platform/index';
import type { LearningQueueItem } from '../types';

function gap(partial: Partial<LearningQueueItem> & { id: string; concept: string }): LearningQueueItem {
  return {
    projectId: 'p1',
    query: `systematic review ${partial.concept} clinical trial`,
    priority: 0.6,
    status: 'pending',
    discoveredAt: '2024-01-01',
    resolvedAt: null,
    partialEvidence: [],
    ...partial,
  };
}

function evidence(partial: Partial<EvidenceItem> & { title: string }): EvidenceItem {
  return {
    source: 'pubmed',
    authors: ['A. Author'],
    identifiers: {},
    fetchedAt: '2024-01-01',
    provenanceHash: partial.title,
    ...partial,
  };
}

describe('evidenceToChunks', () => {
  it('tags distilled chunks as study findings and carries identifiers', () => {
    const items = [evidence({ title: 'Renal effects of X', snippet: 'a randomized controlled trial', identifiers: { pmid: '111' }, year: 2022 })];
    const chunks = evidenceToChunks(items, gap({ id: 'g1', concept: 'renal function' }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.tag).toBe(STUDY_TAG);
    expect(chunks[0]!.pmid).toBe('111');
    expect(chunks[0]!.query).toBe('renal function');
    expect(chunks[0]!.evidenceStrength).toBe('strong'); // "randomized controlled trial"
  });

  it('dedupes by identifier/url/title', () => {
    const items = [
      evidence({ title: 'Dup', identifiers: { doi: '10.1/x' } }),
      evidence({ title: 'Different title', identifiers: { doi: '10.1/x' } }),
    ];
    const chunks = evidenceToChunks(items, gap({ id: 'g1', concept: 'c' }));
    expect(chunks).toHaveLength(1);
  });
});

describe('runStudyPass', () => {
  it('fills gaps that return evidence and resolves only those', async () => {
    const gaps = [gap({ id: 'g1', concept: 'renal' }), gap({ id: 'g2', concept: 'hepatic' })];
    const save = vi.fn();
    const fetchEvidence = vi.fn(async (q: string) =>
      /renal/i.test(q) ? [evidence({ title: 'Renal paper', identifiers: { pmid: '1' } })] : [],
    );

    const result = await runStudyPass('p1', gaps, { fetchEvidence, save });

    expect(result.attempted).toBe(2);
    expect(result.resolvedIds).toEqual(['g1']); // g2 returned nothing → still pending
    expect(result.savedChunks).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('p1', expect.arrayContaining([expect.objectContaining({ tag: STUDY_TAG })]));
  });

  it('leaves a gap pending when its fetch throws', async () => {
    const gaps = [gap({ id: 'g1', concept: 'renal' })];
    const save = vi.fn();
    const fetchEvidence = vi.fn(async () => {
      throw new Error('network down');
    });

    const result = await runStudyPass('p1', gaps, { fetchEvidence, save });

    expect(result.resolvedIds).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });
});
