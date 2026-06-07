import { describe, expect, it } from 'vitest';
import { assessRiskOfBias, formatRobSummary } from '../riskOfBias';
import type { EvidenceExtraction } from '../publicationTypes';

function makeExtraction(
  design: string,
  sampleSize: string | null = null,
  effectValues: { label: string; value: string; sourceText: string }[] = [],
): EvidenceExtraction {
  return {
    id: 'test',
    sourceMarker: '[S1]',
    evidenceIndex: 0,
    source: 'pubmed',
    title: 'Test',
    year: '2024',
    identifiers: {},
    studyDesign: design,
    population: 'adults with asthma',
    exposureOrIntervention: 'statin therapy',
    comparator: 'placebo',
    outcomes: ['efficacy'],
    sampleSize,
    effectValues,
    limitations: [],
    keyFinding: 'Test finding',
    trusted: true,
  };
}

describe('assessRiskOfBias', () => {
  it('assigns RoB 2 to RCTs', () => {
    const r = assessRiskOfBias(makeExtraction('randomized clinical trial', 'n=100'));
    expect(r.tool).toBe('RoB 2');
    expect(r.domains.length).toBeGreaterThan(0);
    expect(r.gradeCertainty).toBeDefined();
  });

  it('assigns ROBINS-I to cohort studies', () => {
    const r = assessRiskOfBias(makeExtraction('cohort study'));
    expect(r.tool).toBe('ROBINS-I');
    expect(r.overall).toBe('high');
  });

  it('assigns AMSTAR-2 to meta-analyses', () => {
    const r = assessRiskOfBias(makeExtraction('meta-analysis'));
    expect(r.tool).toBe('AMSTAR-2');
  });

  it('downgrades imprecision when sample size is missing', () => {
    const r = assessRiskOfBias(makeExtraction('randomized clinical trial'));
    expect(r.downgradeFactors.some((f) => f.includes('imprecision'))).toBe(true);
  });

  it('formats a summary string', () => {
    const r = assessRiskOfBias(makeExtraction('randomized clinical trial', 'n=200'));
    const s = formatRobSummary(r);
    expect(s).toContain('RoB 2');
    expect(s).toContain('GRADE');
  });
});
