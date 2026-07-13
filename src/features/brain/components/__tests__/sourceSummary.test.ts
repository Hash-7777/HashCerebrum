import { describe, expect, it } from 'vitest';
import { summarizeSources } from '../sourceSummary';
import type { EvidenceItem } from '@platform/index';

const rec = (source: EvidenceItem['source']): EvidenceItem => ({
  source,
  title: 't',
  authors: [],
  identifiers: {},
  fetchedAt: new Date(0).toISOString(),
  provenanceHash: 'h',
});

describe('summarizeSources', () => {
  it('returns null when there are no citations', () => {
    expect(summarizeSources(undefined)).toBeNull();
    expect(summarizeSources([])).toBeNull();
  });

  it('counts records and distinct databases with a most-productive-first breakdown', () => {
    const s = summarizeSources([rec('pubmed'), rec('pubmed'), rec('europepmc'), rec('clinvar')]);
    expect(s).not.toBeNull();
    expect(s!.records).toBe(4);
    expect(s!.databases).toBe(3);
    expect(s!.breakdown[0]).toEqual({ label: 'PubMed', count: 2 });
    expect(s!.breakdown.map((b) => b.label)).toContain('Europe PMC');
    expect(s!.breakdown.map((b) => b.label)).toContain('ClinVar');
  });
});
