import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { citedEvidenceFor, memoryChunksForTurn, memoryTopicLabel } from '../memoryTopic';

function rec(title: string): EvidenceItem {
  return {
    source: 'pubmed',
    title,
    authors: [],
    identifiers: {},
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: title,
  };
}

describe('citedEvidenceFor', () => {
  it('keeps only the cited records, in citation order, de-duplicated', () => {
    const evidence = [rec('A'), rec('B'), rec('C'), rec('D')];
    const cited = citedEvidenceFor('Claim [S3]. Another [S1]. Repeat [S3].', evidence);
    expect(cited.map((e) => e.title)).toEqual(['C', 'A']);
  });

  it('returns nothing when the answer cites no records (e.g. a refusal)', () => {
    expect(citedEvidenceFor('No relevant evidence was found.', [rec('A')])).toEqual([]);
  });

  it('drops markers that point past the evidence list', () => {
    expect(citedEvidenceFor('See [S9].', [rec('A')])).toEqual([]);
  });
});

describe('memoryTopicLabel', () => {
  it('returns a subject label from the query, stripping filler words', () => {
    const label = memoryTopicLabel('i want to compare panadol and cataflam on renal effect');
    expect(label).not.toBeNull();
    expect(label).toContain('panadol');
    expect(label).toContain('cataflam');
    expect(label).toContain('renal');
    expect(label).not.toContain('want');
    expect(label).not.toContain('compare');
  });

  it('returns null when nothing meaningful remains', () => {
    expect(memoryTopicLabel('so what about it?')).toBeNull();
  });
});

describe('memoryChunksForTurn', () => {
  const evidence: EvidenceItem[] = [
    { ...rec('Warfarin and NSAIDs bleeding cohort'), snippet: 'Bleeding risk rose.', year: 2021, identifiers: { pmid: '111', doi: '10.1/x' } },
    rec('Uncited record'),
  ];
  const base = {
    question: 'warfarin ibuprofen bleeding risk',
    answer: 'Concomitant use raised bleeding risk [S1].',
    evidence,
    runId: 'run-1',
  };

  it('saves the cited evidence and the answer, filed under the subject label', () => {
    const chunks = memoryChunksForTurn(base)!;
    expect(chunks.map((c) => c.kind)).toEqual(['evidence', 'answer']);
    expect(chunks[0]).toMatchObject({ title: 'Warfarin and NSAIDs bleeding cohort', runId: 'run-1', pmid: '111', doi: '10.1/x', year: 2021 });
    expect(chunks[1]).toMatchObject({ text: base.answer, query: 'warfarin ibuprofen bleeding risk' });
    expect(chunks.some((c) => 'tag' in c)).toBe(false);
  });

  it('saves nothing for a question about the app itself', () => {
    expect(memoryChunksForTurn({ ...base, question: 'what model are you' })).toBeNull();
  });

  it('saves nothing when the answer cited no record', () => {
    expect(memoryChunksForTurn({ ...base, answer: 'No relevant evidence was found.' })).toBeNull();
  });

  it('saves a drug-interaction turn only with a confident verdict, and tags it', () => {
    expect(memoryChunksForTurn({ ...base, focus: 'drug_interactions', answer: 'Insufficient evidence to grade [S1].' })).toBeNull();
    const chunks = memoryChunksForTurn({ ...base, focus: 'drug_interactions' })!;
    expect(chunks.every((c) => c.tag === 'drug_interactions')).toBe(true);
  });

  it('saves a genetics turn only when its confidence band is above insufficient', () => {
    expect(memoryChunksForTurn({ ...base, focus: 'genetics' })).toBeNull();
    const chunks = memoryChunksForTurn({ ...base, focus: 'genetics', answer: 'Association confidence: 62% — moderate [S1].' })!;
    expect(chunks.every((c) => c.tag === 'genetics')).toBe(true);
  });
});
