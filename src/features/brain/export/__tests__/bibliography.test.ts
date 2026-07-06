import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { buildBibtex, buildRis } from '../bibliography';

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

const article = rec({
  title: 'SGLT2 inhibitors and cardiovascular outcomes',
  authors: ['Smith, John A.', 'Doe, Barbara'],
  year: 2024,
  volume: '390',
  issue: '3',
  pages: '221-230',
  source: 'pubmed',
  identifiers: { doi: '10.1056/abc', pmid: '38912345', journal: 'N Engl J Med' },
});

describe('buildBibtex', () => {
  it('emits an @article with a deterministic key, authors, doi, pmid, and a resolved URL', () => {
    const bib = buildBibtex([article]);
    expect(bib).toContain('@article{smith2024,');
    expect(bib).toContain('author = {Smith, John A. and Doe, Barbara}');
    expect(bib).toContain('title = {{SGLT2 inhibitors and cardiovascular outcomes}}');
    expect(bib).toContain('journal = {N Engl J Med}');
    expect(bib).toContain('year = {2024}');
    expect(bib).toContain('pages = {221--230}');
    expect(bib).toContain('doi = {10.1056/abc}');
    expect(bib).toContain('pmid = {38912345}');
    expect(bib).toContain('url = {https://doi.org/10.1056/abc}');
  });

  it('uses @misc and howpublished for a non-article source (trial / label)', () => {
    const trial = rec({
      title: 'A trial of empagliflozin',
      source: 'ctgov',
      identifiers: { nctId: 'NCT03119116' },
    });
    const bib = buildBibtex([trial]);
    expect(bib).toContain('@misc{');
    expect(bib).not.toContain('@article{');
    expect(bib).toContain('url = {https://clinicaltrials.gov/study/NCT03119116}');
  });

  it('escapes LaTeX-special characters in fields', () => {
    const bib = buildBibtex([rec({ title: 'Risk & benefit at 5% vs placebo', authors: ['A_B'] })]);
    expect(bib).toContain('Risk \\& benefit at 5\\% vs placebo');
    expect(bib).toContain('A\\_B');
  });

  it('disambiguates duplicate keys with a/b suffixes', () => {
    const a = rec({ title: 'One', authors: ['Smith J'], year: 2024 });
    const b = rec({ title: 'Two', authors: ['Smith K'], year: 2024 });
    const bib = buildBibtex([a, b]);
    expect(bib).toContain('@article{smith2024,');
    expect(bib).toContain('@article{smith2024a,');
  });
});

describe('buildRis', () => {
  it('emits a JOUR record with author lines, journal, DOI, PMID (AN), URL, and split pages', () => {
    const ris = buildRis([article]);
    expect(ris).toContain('TY  - JOUR');
    expect(ris).toContain('AU  - Smith, John A.');
    expect(ris).toContain('AU  - Doe, Barbara');
    expect(ris).toContain('TI  - SGLT2 inhibitors and cardiovascular outcomes');
    expect(ris).toContain('T2  - N Engl J Med');
    expect(ris).toContain('PY  - 2024');
    expect(ris).toContain('SP  - 221');
    expect(ris).toContain('EP  - 230');
    expect(ris).toContain('DO  - 10.1056/abc');
    expect(ris).toContain('AN  - 38912345');
    expect(ris).toContain('UR  - https://doi.org/10.1056/abc');
    expect(ris.trimEnd().endsWith('ER  -')).toBe(true);
  });

  it('marks a non-article record as GEN', () => {
    const ris = buildRis([rec({ title: 'A label', source: 'openfda' })]);
    expect(ris).toContain('TY  - GEN');
  });
});
