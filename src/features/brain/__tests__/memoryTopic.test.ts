import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { citedEvidenceFor, memoryTopicLabel } from '../memoryTopic';

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
