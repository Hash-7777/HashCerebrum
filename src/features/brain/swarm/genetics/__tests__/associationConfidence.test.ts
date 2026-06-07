import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import {
  associationConfidence,
  associationPointsFromEvidence,
  bandFor,
  confidenceFromEvidence,
  type AssociationDataPoint,
} from '../associationConfidence';

const pt = (p: Partial<AssociationDataPoint> & { direction: AssociationDataPoint['direction'] }): AssociationDataPoint => ({
  source: 'gwas_catalog',
  significant: true,
  ...p,
});

describe('associationConfidence', () => {
  it('returns insufficient with no evidence', () => {
    const r = associationConfidence([]);
    expect(r.band).toBe('insufficient');
    expect(r.score).toBe(0);
    expect(r.pooledDirection).toBe('none');
  });

  it('returns insufficient when nothing is significant', () => {
    const r = associationConfidence([pt({ direction: 'risk', significant: false })]);
    expect(r.band).toBe('insufficient');
    expect(r.score).toBe(0);
  });

  it('scores a single significant GWAS association as moderate', () => {
    const r = associationConfidence([pt({ direction: 'risk' })]);
    expect(r.score).toBeGreaterThanOrEqual(40);
    expect(r.score).toBeLessThan(60);
    expect(r.band).toBe('moderate');
    expect(r.pooledDirection).toBe('risk');
  });

  it('rises with more concordant significant associations', () => {
    const one = associationConfidence([pt({ direction: 'risk' })]).score;
    const five = associationConfidence(Array.from({ length: 5 }, () => pt({ direction: 'risk' }))).score;
    expect(five).toBeGreaterThan(one);
    expect(five).toBeGreaterThanOrEqual(80); // strong/very strong
  });

  it('penalizes a mixed risk/protective direction', () => {
    const concordant = associationConfidence(Array.from({ length: 4 }, () => pt({ direction: 'risk' }))).score;
    const mixed = associationConfidence([
      pt({ direction: 'risk' }),
      pt({ direction: 'risk' }),
      pt({ direction: 'protective' }),
      pt({ direction: 'protective' }),
    ]);
    expect(mixed.score).toBeLessThan(concordant);
    expect(mixed.pooledDirection).toBe('mixed');
  });

  it('lowers confidence when benign/null records refute the correlation', () => {
    const clean = associationConfidence([pt({ direction: 'risk' }), pt({ direction: 'risk' })]).score;
    const refuted = associationConfidence([
      pt({ direction: 'risk' }),
      pt({ direction: 'risk' }),
      pt({ source: 'clinvar', direction: 'neutral' }),
    ]).score;
    expect(refuted).toBeLessThan(clean);
  });

  it('gives a small boost for a curated ClinVar pathogenic record', () => {
    const gwasOnly = associationConfidence([pt({ direction: 'risk' })]).score;
    const withClinvar = associationConfidence([
      pt({ direction: 'risk' }),
      pt({ source: 'clinvar', direction: 'risk' }),
    ]).score;
    expect(withClinvar).toBeGreaterThan(gwasOnly);
  });

  it('maps scores to bands at the right thresholds', () => {
    expect(bandFor(10)).toBe('insufficient');
    expect(bandFor(20)).toBe('weak');
    expect(bandFor(40)).toBe('moderate');
    expect(bandFor(60)).toBe('strong');
    expect(bandFor(85)).toBe('very strong');
  });
});

describe('associationPointsFromEvidence', () => {
  const rec = (partial: Partial<EvidenceItem> & { source: EvidenceItem['source'] }): EvidenceItem => ({
    title: 'rec',
    authors: [],
    identifiers: {},
    fetchedAt: '',
    provenanceHash: 'h',
    ...partial,
  });

  it('reads OR/CI/p from a GWAS record (significant risk)', () => {
    const points = associationPointsFromEvidence([
      rec({ source: 'gwas_catalog', identifiers: { oddsRatio: '1.42', ci: '[1.10-1.84]', pValue: '3e-6' } }),
    ]);
    expect(points).toEqual([{ source: 'gwas_catalog', significant: true, direction: 'risk' }]);
  });

  it('marks a GWAS record non-significant when CI crosses 1 and p is high', () => {
    const points = associationPointsFromEvidence([
      rec({ source: 'gwas_catalog', identifiers: { oddsRatio: '1.1', ci: '[0.80-1.50]', pValue: '0.3' } }),
    ]);
    expect(points[0]?.significant).toBe(false);
  });

  it('classifies a protective OR below 1', () => {
    const points = associationPointsFromEvidence([
      rec({ source: 'gwas_catalog', identifiers: { oddsRatio: '0.68', ci: '[0.55-0.84]', pValue: '0.001' } }),
    ]);
    expect(points[0]?.direction).toBe('protective');
  });

  it('reads ClinVar clinical significance', () => {
    const points = associationPointsFromEvidence([
      rec({ source: 'clinvar', identifiers: { clinicalSignificance: 'Likely pathogenic' } }),
      rec({ source: 'clinvar', identifiers: { clinicalSignificance: 'Benign' } }),
      rec({ source: 'clinvar', identifiers: { clinicalSignificance: 'Uncertain significance' } }),
    ]);
    expect(points).toEqual([
      { source: 'clinvar', significant: true, direction: 'risk' },
      { source: 'clinvar', significant: true, direction: 'neutral' },
    ]); // uncertain → dropped
  });

  it('ignores non-genetic sources', () => {
    expect(associationPointsFromEvidence([rec({ source: 'pubmed' })])).toEqual([]);
  });

  it('confidenceFromEvidence ties it together (MICA-style risk association)', () => {
    const result = confidenceFromEvidence([
      rec({ source: 'gwas_catalog', identifiers: { oddsRatio: '2.4', ci: '[1.5-3.9]', pValue: '0.0001' } }),
      rec({ source: 'clinvar', identifiers: { clinicalSignificance: 'risk factor' } }),
    ]);
    expect(result.pooledDirection).toBe('risk');
    expect(result.score).toBeGreaterThan(40);
  });
});
