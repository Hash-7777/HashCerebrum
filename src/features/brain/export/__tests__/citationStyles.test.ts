import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { formatReference, referenceUrl } from '../citationStyles';

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

  it('uses the journal name when an adapter captured it, not the database label', () => {
    const withJournal = rec({
      title: 'SGLT2 inhibitors in HFpEF',
      authors: ['Anker SD'],
      year: 2021,
      identifiers: { pmid: '34449189', journal: 'N Engl J Med' },
    });
    const out = formatReference(withJournal, 'vancouver');
    expect(out).toContain('N Engl J Med.');
    expect(out).not.toContain('PubMed');
  });

  it('still shows the database label when no journal is known (no regression)', () => {
    const noJournal = rec({ title: 'No journal', authors: ['Smith J'], year: 2022 });
    expect(formatReference(noJournal, 'vancouver')).toContain('PubMed');
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

describe('referenceUrl — best link to the real paper', () => {
  it('prefers the DOI, resolved through doi.org', () => {
    expect(referenceUrl(rec({ title: 't', identifiers: { doi: '10.1/abc', pmid: '99887' } }))).toBe(
      'https://doi.org/10.1/abc',
    );
  });

  it('strips an existing doi.org prefix so the DOI is not doubled', () => {
    expect(referenceUrl(rec({ title: 't', identifiers: { doi: 'https://doi.org/10.2/xyz' } }))).toBe(
      'https://doi.org/10.2/xyz',
    );
  });

  it('falls back to a PubMed link when only a PMID is present', () => {
    expect(referenceUrl(rec({ title: 't', identifiers: { pmid: '34449189' } }))).toBe(
      'https://pubmed.ncbi.nlm.nih.gov/34449189/',
    );
  });

  it('falls back to PMC, then ClinicalTrials.gov, then the record URL', () => {
    expect(referenceUrl(rec({ title: 't', identifiers: { pmcid: 'PMC7654321' } }))).toBe(
      'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7654321/',
    );
    expect(referenceUrl(rec({ title: 't', identifiers: { nctId: 'NCT03119116' } }))).toBe(
      'https://clinicaltrials.gov/study/NCT03119116',
    );
    expect(referenceUrl(rec({ title: 't', url: 'https://example.org/paper' }))).toBe(
      'https://example.org/paper',
    );
  });

  it('returns null when nothing resolvable is present, and never a non-web URL', () => {
    expect(referenceUrl(rec({ title: 't' }))).toBeNull();
    expect(referenceUrl(rec({ title: 't', url: 'javascript:alert(1)' }))).toBeNull();
  });
});
