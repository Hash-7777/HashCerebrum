import { describe, expect, it } from 'vitest';
import { buildQuantEvidenceTable, findUnverifiedStatistics } from '../paperPipeline';
import type { EvidenceExtraction } from '../publicationTypes';

function ext(marker: string, partial: Partial<EvidenceExtraction> = {}): EvidenceExtraction {
  return {
    id: `x-${marker}`,
    sourceMarker: marker,
    evidenceIndex: 0,
    source: 'pubmed',
    title: 'A study',
    year: '2024',
    identifiers: {},
    studyDesign: 'RCT',
    population: '',
    exposureOrIntervention: '',
    comparator: '',
    outcomes: [],
    sampleSize: null,
    effectValues: [],
    limitations: [],
    keyFinding: '',
    trusted: true,
    ...partial,
  };
}

describe('buildQuantEvidenceTable', () => {
  it('collects every numeric token a source reports, keyed by its marker', () => {
    const qet = buildQuantEvidenceTable([
      ext('[S12]', {
        boundEffects: [{ measure: 'HR', value: '0.94', ci: '0.90-0.99', pValue: '0.02', direction: 'reduction', sourceText: 'HR 0.94' }],
        effectValues: [{ label: 'hazard ratio', value: '0.86', sourceText: 'HR 0.86' }],
      }),
    ]);
    const s12 = qet.get('[S12]')!;
    expect([...s12].sort()).toEqual(['0.02', '0.86', '0.9', '0.94', '0.99']);
  });
});

describe('findUnverifiedStatistics', () => {
  const qet = new Map<string, Set<string>>([['[S12]', new Set(['0.94', '0.9', '0.99', '0.02'])]]);

  it('flags a statistic attributed to a source that does not report it (D3)', () => {
    // The real bug: [S12] cited with an HR of 1.05 when it only reports 0.94.
    const out = findUnverifiedStatistics(
      'The trial reported a neutral effect (hazard ratio 1.05, 95% CI 1.0-1.1) [S12].',
      qet,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((u) => u.sourceText.includes('1.05'))).toBe(true);
    expect(out[0]!.markers).toEqual(['[S12]']);
  });

  it('passes a statistic the cited source actually reports', () => {
    const out = findUnverifiedStatistics(
      'The trial reported a modest benefit (hazard ratio 0.94, 95% CI 0.90-0.99) [S12].',
      qet,
    );
    expect(out).toEqual([]);
  });

  it('does not check a sentence with no citation', () => {
    expect(findUnverifiedStatistics('Overall the hazard ratio was around 1.05.', qet)).toEqual([]);
  });

  it('flags a context-free garbage number pinned to a source (D4)', () => {
    const out = findUnverifiedStatistics('The analysis yielded an odds ratio of 2.08 [S12].', qet);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((u) => u.sourceText.includes('2.08'))).toBe(true);
  });
});
