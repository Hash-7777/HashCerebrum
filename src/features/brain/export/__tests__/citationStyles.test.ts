import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { formatReference } from '../citationStyles';

function rec(partial: Partial<EvidenceItem> & { title: string }): EvidenceItem {
  return {
    source: 'pubmed',
    authors: [],
    identifiers: {},
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: 'h',
    ...partial,
  };
}

const study = rec({
  title: 'Warfarin and NSAID bleeding risk',
  authors: ['John A. Smith', 'Barbara Doe', 'Carl Lee'],
  year: 2020,
  identifiers: { doi: '10.1/abc', pmid: '99887' },
});

describe('formatReference — Vancouver (default)', () => {
  it('keeps full author names, year, doi and PMID', () => {
    const out = formatReference(study, 'vancouver');
    expect(out).toContain('John A. Smith, Barbara Doe, Carl Lee');
    expect(out).toContain('Warfarin and NSAID bleeding risk');
    expect(out).toContain('2020.');
    expect(out).toContain('doi:10.1/abc');
    expect(out).toContain('PMID:99887');
  });

  it('falls back to the source label when there are no authors', () => {
    expect(formatReference(rec({ title: 'Label record', source: 'openfda' }), 'vancouver')).toContain('openFDA');
  });
});

describe('formatReference — APA', () => {
  it('uses Family, Initials with an ampersand and a parenthesised year', () => {
    const out = formatReference(study, 'apa');
    expect(out).toContain('Smith, J.A., Doe, B., & Lee, C.');
    expect(out).toContain('(2020).');
    expect(out).toContain('https://doi.org/10.1/abc');
  });

  it('marks a missing year as n.d.', () => {
    const out = formatReference(rec({ title: 'Undated', authors: ['Jane Roe'] }), 'apa');
    expect(out).toContain('(n.d.).');
    expect(out).toContain('Roe, J.');
  });
});

describe('formatReference — Harvard', () => {
  it('joins authors with "and" and quotes the title', () => {
    const out = formatReference(study, 'harvard');
    expect(out).toContain('Smith, J.A., Doe, B. and Lee, C.');
    expect(out).toContain("'Warfarin and NSAID bleeding risk'");
    expect(out).toContain('(2020)');
    expect(out).toContain('Available at: https://doi.org/10.1/abc');
  });
});

describe('formatReference — imported library document', () => {
  const libDoc = rec({
    title: 'Local Project Paper on Anticoagulation',
    source: 'library',
    authors: ['Jane Roe'],
    year: 2019,
    identifiers: { docId: 'abc123', page: '12' },
  });

  it('labels it as an imported document and appends the page', () => {
    const out = formatReference(libDoc, 'vancouver');
    expect(out).toContain('Imported document');
    expect(out).toContain('p. 12.');
    expect(out).toContain('Local Project Paper on Anticoagulation');
  });

  it('works across styles', () => {
    expect(formatReference(libDoc, 'apa')).toContain('Imported document');
    expect(formatReference(libDoc, 'harvard')).toContain('Imported document');
  });
});

describe('formatReference — comma-form author names', () => {
  it('parses "Family, Given" without duplicating the family name', () => {
    const out = formatReference(rec({ title: 'X', authors: ['Smith, John'] }), 'apa');
    expect(out).toContain('Smith, J.');
  });
});

describe('formatReference — advance online publication', () => {
  const future = new Date().getFullYear() + 1;
  const aheadOfPrint = rec({ title: 'Future-dated indexed study', year: future, source: 'europepmc' });
  const current = rec({ title: 'Current-year study', year: new Date().getFullYear(), source: 'europepmc' });

  it('labels a future-dated record as advance online across styles', () => {
    for (const style of ['vancouver', 'apa', 'harvard'] as const) {
      expect(formatReference(aheadOfPrint, style)).toContain('Advance online publication.');
    }
  });

  it('leaves current-year and earlier records unannotated', () => {
    expect(formatReference(current, 'vancouver')).not.toContain('Advance online');
    expect(formatReference(study, 'vancouver')).not.toContain('Advance online');
  });
});
