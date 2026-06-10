import { describe, expect, it } from 'vitest';
import { buildEvidenceMeta, buildRatioMeta, buildSmdMeta, formatMetaResult } from '../metaAnalysis';
import type { EvidenceExtraction } from '../publicationTypes';

function makeRatio(marker: string, text: string): EvidenceExtraction {
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
    outcomes: ['mortality'],
    sampleSize: 'n=1000',
    effectValues: [{ label: 'finding', value: '', sourceText: '' }],
    limitations: [],
    keyFinding: text,
    trusted: true,
  };
}

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

describe('buildRatioMeta', () => {
  it('pools hazard ratios reported with 95% CIs (log-scale, exponentiated)', () => {
    const r = buildRatioMeta([
      makeRatio('[S1]', 'hazard ratio 0.80 (95% CI 0.74-0.86)'),
      makeRatio('[S2]', 'hazard ratio 0.76 (95% CI 0.72 to 0.81)'),
      makeRatio('[S3]', 'hazard ratio 0.90 (95% CI 0.79-1.02)'),
    ]);
    expect(r).toBeDefined();
    expect(r!.kind).toBe('hr');
    expect(r!.studies).toBe(3);
    // Pooled HR sits among the inputs and is protective with CI excluding 1.
    expect(r!.pooledPoint).toBeGreaterThan(0.7);
    expect(r!.pooledPoint).toBeLessThan(0.9);
    expect(r!.ciLow < r!.pooledPoint && r!.pooledPoint < r!.ciHigh).toBe(true);
    expect(r!.ciHigh).toBeLessThan(1);
    expect(r!.interpretable).toBe(true);
  });

  it('requires at least two studies and a CI', () => {
    expect(buildRatioMeta([makeRatio('[S1]', 'hazard ratio 0.80 (95% CI 0.74-0.86)')])).toBeUndefined();
    expect(
      buildRatioMeta([makeRatio('[S1]', 'hazard ratio 0.80'), makeRatio('[S2]', 'hazard ratio 0.76')]),
    ).toBeUndefined();
  });

  it('never mistakes the English word "or" for an odds ratio', () => {
    expect(
      buildRatioMeta([
        makeRatio('[S1]', 'metformin or placebo was given and the outcome improved'),
        makeRatio('[S2]', 'aspirin or warfarin, either or both, were compared'),
      ]),
    ).toBeUndefined();
  });

  it('pools HR shorthand with semicolon separator (HR 0.80; 95% CI 0.74-0.86)', () => {
    const r = buildRatioMeta([
      makeRatio('[S1]', 'HR 0.80; 95% CI 0.74-0.86'),
      makeRatio('[S2]', 'HR 0.76; 95% CI 0.72 to 0.81'),
      makeRatio('[S3]', 'HR 0.90; 95% CI 0.79-1.02'),
    ]);
    expect(r).toBeDefined();
    expect(r!.kind).toBe('hr');
    expect(r!.studies).toBe(3);
  });

  it('pools OR shorthand (OR 1.5, 95% CI 1.2-1.9)', () => {
    const r = buildRatioMeta([
      makeRatio('[S1]', 'OR 1.5, 95% CI 1.2-1.9'),
      makeRatio('[S2]', 'OR 1.3 (95% CI 1.1-1.6)'),
    ]);
    expect(r).toBeDefined();
    expect(r!.kind).toBe('or');
    expect(r!.studies).toBe(2);
  });

  it('pools RR shorthand (RR 0.65; 95% CI 0.50-0.85)', () => {
    const r = buildRatioMeta([
      makeRatio('[S1]', 'RR 0.65; 95% CI 0.50-0.85'),
      makeRatio('[S2]', 'RR 0.70 (95% CI 0.55-0.90)'),
    ]);
    expect(r).toBeDefined();
    expect(r!.kind).toBe('rr');
    expect(r!.studies).toBe(2);
  });
});

describe('buildEvidenceMeta', () => {
  it('falls back to ratio pooling when no continuous outcomes exist', () => {
    const r = buildEvidenceMeta([
      makeRatio('[S1]', 'odds ratio 1.5 (95% CI 1.2-1.9)'),
      makeRatio('[S2]', 'odds ratio 1.3 (95% CI 1.1-1.6)'),
    ]);
    expect(r?.kind).toBe('or');
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
