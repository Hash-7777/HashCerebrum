import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import {
  buildCitedClaims,
  extractCitedClaims,
  pairClaimsToSources,
  sourcesForMarkers,
} from '../citationAudit';

function rec(partial: Partial<EvidenceItem> & { title: string }): EvidenceItem {
  return {
    source: 'pubmed',
    authors: ['A'],
    identifiers: {},
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: 'h',
    ...partial,
  };
}

describe('extractCitedClaims', () => {
  it('keeps only sentences that carry a citation marker', () => {
    const text =
      'Warfarin needs monitoring. NSAIDs raise bleeding risk with warfarin [2]. This sentence has none.';
    const claims = extractCitedClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.markers).toEqual([2]);
    expect(claims[0]!.sentence).toContain('bleeding risk');
  });

  it('collects multiple distinct markers in order, de-duplicated', () => {
    const claims = extractCitedClaims('The effect is additive [3][1] and confirmed again [3].');
    expect(claims).toHaveLength(1);
    expect(claims[0]!.markers).toEqual([3, 1]);
  });

  it('ignores reference-list lines that begin with a marker', () => {
    const text = 'Bleeding rises [1].\n[1] Smith J. Warfarin and NSAIDs. 2020.';
    const claims = extractCitedClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.sentence).toContain('Bleeding rises');
  });

  it('returns nothing for empty or marker-free text', () => {
    expect(extractCitedClaims('')).toEqual([]);
    expect(extractCitedClaims('No citations here at all.')).toEqual([]);
  });
});

describe('pairClaimsToSources', () => {
  const citations = [
    rec({ title: 'Warfarin–NSAID meta-analysis', snippet: 'Increased major bleeding with NSAIDs.' }),
    rec({ title: 'No-snippet record', snippet: null }),
    rec({ title: 'Mechanism review', snippet: 'CYP2C9 inhibition raises free warfarin.' }),
  ];

  it('resolves markers to the 1-based cited record and keeps snippet-bearing sources', () => {
    const paired = pairClaimsToSources(
      [{ sentence: 'Additive risk [1][3].', markers: [1, 3] }],
      citations,
    );
    expect(paired).toHaveLength(1);
    expect(paired[0]!.sources.map((s) => s.marker)).toEqual([1, 3]);
    expect(paired[0]!.sources[0]!.title).toBe('Warfarin–NSAID meta-analysis');
    expect(paired[0]!.sources[0]!.snippet).toContain('major bleeding');
  });

  it('drops sources without a snippet, and claims left with none', () => {
    // [2] has no snippet → its source is dropped; the claim then has no
    // verifiable source and is removed entirely.
    const paired = pairClaimsToSources([{ sentence: 'Claim [2].', markers: [2] }], citations);
    expect(paired).toEqual([]);
  });

  it('drops a marker that points past the citation list', () => {
    const paired = pairClaimsToSources([{ sentence: 'Phantom [9].', markers: [9] }], citations);
    expect(paired).toEqual([]);
  });

  it('caps the number of claims returned', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ sentence: `Claim ${i} [1].`, markers: [1] }));
    expect(pairClaimsToSources(many, citations, 5)).toHaveLength(5);
  });
});

describe('sourcesForMarkers', () => {
  const citations = [
    rec({
      title: 'Warfarin–NSAID meta-analysis',
      snippet: 'Increased major bleeding.',
      year: 2020,
      identifiers: { pmid: '12345' },
      url: 'https://example.org/a',
    }),
    rec({
      title: 'Mechanism review',
      snippet: 'CYP2C9 inhibition.',
      identifiers: { DOI: '10.1/xyz' },
    }),
    rec({ title: 'Link-only record', url: 'https://example.org/c' }),
  ];

  it('resolves markers to display records with year + PMID/DOI/url', () => {
    const out = sourcesForMarkers([1, 2, 3], citations);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ marker: 1, year: '2020', pmid: '12345', url: 'https://example.org/a' });
    expect(out[1]).toMatchObject({ marker: 2, doi: '10.1/xyz' });
    expect(out[1]!.pmid).toBeUndefined();
    expect(out[2]).toMatchObject({ marker: 3, url: 'https://example.org/c' });
    expect(out[2]!.year).toBeUndefined();
  });

  it('skips markers that point past the citation list', () => {
    expect(sourcesForMarkers([9], citations)).toEqual([]);
  });
});

describe('buildCitedClaims', () => {
  it('extracts and pairs in one step', () => {
    const citations = [rec({ title: 'Bleeding study', snippet: 'Higher INR observed.' })];
    const claims = buildCitedClaims('INR rose on the combination [1]. Background sentence.', citations);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.sources[0]!.title).toBe('Bleeding study');
  });
});
