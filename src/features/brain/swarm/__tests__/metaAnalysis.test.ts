import { describe, expect, it } from 'vitest';
import { buildSmdMeta, formatMetaResult } from '../metaAnalysis';
import type { EvidenceExtraction } from '../publicationTypes';

function makeExtraction(marker: string, sampleSize: string, effectText: string): EvidenceExtraction {
  return {
    id: 'test',
    sourceMarker: marker,
    evidenceIndex: 0,
    source: 'pubmed',
    title: 'Test',
    year: '2024',
    identifiers: {},
    studyDesign: 'randomized clinical trial',
    population: 'adults',
    exposureOrIntervention: 'drug',
    comparator: 'placebo',
    outcomes: ['efficacy'],
    sampleSize,
    effectValues: [{ label: 'mean difference', value: '2.5', sourceText: effectText }],
    limitations: [],
    keyFinding: 'Test',
    trusted: true,
  };
}

describe('buildSmdMeta', () => {
  it('returns undefined with <2 studies', () => {
    const r = buildSmdMeta([makeExtraction('[S1]', 'n=50', 'mean 12.3 ± 2.1')]);
    expect(r).toBeUndefined();
  });

  it('computes a pooled estimate for ≥2 studies', () => {
    const extractions = [
      makeExtraction('[S1]', 'n=100', 'mean 12.3 ± 2.1'),
      makeExtraction('[S2]', 'n=120', 'mean 14.1 ± 2.5'),
    ];
    const r = buildSmdMeta(extractions);
    expect(r).toBeDefined();
    expect(r!.studies).toBe(2);
    expect(Number.isFinite(r!.pooledPoint)).toBe(true);
    expect(Number.isFinite(r!.ciLow)).toBe(true);
    expect(Number.isFinite(r!.ciHigh)).toBe(true);
    expect(r!.ciLow < r!.pooledPoint && r!.pooledPoint < r!.ciHigh).toBe(true);
    expect(r!.interpretable).toBe(true);
  });

  it('includes I² and Q statistics', () => {
    const extractions = [
      makeExtraction('[S1]', 'n=80', 'mean 10.0 ± 1.5'),
      makeExtraction('[S2]', 'n=90', 'mean 11.0 ± 1.8'),
      makeExtraction('[S3]', 'n=100', 'mean 12.0 ± 2.0'),
    ];
    const r = buildSmdMeta(extractions);
    expect(r).toBeDefined();
    expect(Number.isFinite(r!.i2)).toBe(true);
    expect(Number.isFinite(r!.qStatistic)).toBe(true);
    expect(r!.qDf).toBe(2);
  });
});

describe('formatMetaResult', () => {
  it('produces a human-readable summary', () => {
    const extractions = [
      makeExtraction('[S1]', 'n=100', 'mean 12.3 ± 2.1'),
      makeExtraction('[S2]', 'n=120', 'mean 14.1 ± 2.5'),
    ];
    const r = buildSmdMeta(extractions)!;
    const text = formatMetaResult(r);
    expect(text).toContain('SMD meta-analysis');
    expect(text).toContain('I²=');
    expect(text).toContain('τ²=');
    expect(text).toContain('Prediction interval');
  });
});
