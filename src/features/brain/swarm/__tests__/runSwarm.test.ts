import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { evidenceScore, isNonCitableProceeding, mergeEvidence } from '../runSwarm';
import type { SpecialistResult } from '../types';

function makeRecord(partial: Partial<EvidenceItem> & { source: EvidenceItem['source'] }): EvidenceItem {
  return {
    title: 'Test record',
    authors: ['Test'],
    identifiers: {},
    fetchedAt: new Date().toISOString(),
    provenanceHash: 'test',
    ...partial,
  };
}

function makeSpecialist(evidence: EvidenceItem[]): SpecialistResult {
  return {
    agentId: 'literature',
    label: 'Literature',
    subQuery: 'test',
    findings: '',
    evidence,
    toolCalls: 0,
  };
}

describe('evidenceScore', () => {
  it('scores ctgov higher than openalex', () => {
    const ctgov = makeRecord({ source: 'ctgov', year: 2020 });
    const openalex = makeRecord({ source: 'openalex', year: 2020 });
    expect(evidenceScore(ctgov)).toBeGreaterThan(evidenceScore(openalex));
  });

  it('rewards recency up to a cap', () => {
    const oldRecord = makeRecord({ source: 'pubmed', year: 2010 });
    const newRecord = makeRecord({ source: 'pubmed', year: 2026 });
    expect(evidenceScore(newRecord)).toBeGreaterThan(evidenceScore(oldRecord));
  });

  it('rewards url and snippet presence', () => {
    const minimal = makeRecord({ source: 'pubmed', year: 2020 });
    const rich = makeRecord({ source: 'pubmed', year: 2020, url: 'https://example.com', snippet: 'A detailed snippet that explains the findings.' });
    expect(evidenceScore(rich)).toBeGreaterThan(evidenceScore(minimal));
  });
});

describe('mergeEvidence', () => {
  it('deduplicates by key', () => {
    const record = makeRecord({ source: 'pubmed', year: 2020, identifiers: { pmid: '123' } });
    const specialists = [makeSpecialist([record, record])];
    const merged = mergeEvidence(specialists);
    expect(merged).toHaveLength(1);
  });

  it('ranks higher-quality evidence first', () => {
    const low = makeRecord({ source: 'rxnorm', year: 2010 });
    const high = makeRecord({ source: 'ctgov', year: 2026, url: 'https://example.com', snippet: 'Detailed findings here.' });
    const specialists = [makeSpecialist([low, high])];
    const merged = mergeEvidence(specialists);
    expect(merged[0]).toBe(high);
    expect(merged[1]).toBe(low);
  });

  it('merges evidence from multiple specialists', () => {
    const s1 = makeSpecialist([makeRecord({ source: 'pubmed', year: 2020, identifiers: { pmid: '1' } })]);
    const s2 = makeSpecialist([makeRecord({ source: 'ctgov', year: 2020, identifiers: { pmid: '2' } })]);
    const merged = mergeEvidence([s1, s2]);
    expect(merged).toHaveLength(2);
  });

  it('drops conference-proceeding and abstract-collection records', () => {
    const titled = (title: string) => makeRecord({ source: 'europepmc', title });
    expect(isNonCitableProceeding(titled('ESICM LIVES 2024. Barcelona, Spain.'))).toBe(true);
    expect(isNonCitableProceeding(titled('UEG Week 2025 Moderated Posters'))).toBe(true);
    expect(isNonCitableProceeding(titled('E-Posters'))).toBe(true);
    expect(isNonCitableProceeding(titled('Book of Posters'))).toBe(true);
    expect(
      isNonCitableProceeding(titled('Abstracts from the 2020 Annual Meeting of the Society of General Internal Medicine')),
    ).toBe(true);
    // A real study title is kept.
    expect(
      isNonCitableProceeding(titled('Antimicrobial stewardship interventions in adults with hospital-acquired pneumonia')),
    ).toBe(false);

    const real = makeRecord({ source: 'pubmed', title: 'Bleeding risk in anticoagulated patients', identifiers: { pmid: '1' } });
    const poster = makeRecord({ source: 'europepmc', title: 'UEG Week 2024 Poster Presentations', identifiers: { pmid: '2' } });
    const merged = mergeEvidence([makeSpecialist([real, poster])]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe('Bleeding risk in anticoagulated patients');
  });
});
