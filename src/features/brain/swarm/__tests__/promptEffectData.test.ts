import { describe, expect, it } from 'vitest';
import {
  parsePromptEffectRows,
  resetSyntheticIds,
  toSyntheticExtractions,
} from '../promptEffectData';

describe('parsePromptEffectRows', () => {
  it('parses a structured block of HR rows with CI and sample size', () => {
    const question = `
Data:
DAPA-HF (n=4744): HR 0.74 (95% CI 0.65-0.85)
EMPEROR-Reduced (n=3730): HR 0.80 (95% CI 0.72-0.89)
DELIVER (n=6263): HR 0.82 (95% CI 0.73-0.92)

Requirements: write a full paper with statistics.
`;
    const rows = parsePromptEffectRows(question);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      label: 'DAPA-HF',
      measure: 'HR',
      point: 0.74,
      ciLow: 0.65,
      ciHigh: 0.85,
      sampleSize: 4744,
    });
  });

  it('parses OR and RR rows without sample size', () => {
    const question = `
Studies:
- Trial A: OR 1.42 (95% CI 1.10-1.84)
- Trial B: RR 0.65 (95% CI 0.50-0.80)
`;
    const rows = parsePromptEffectRows(question);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.measure).toBe('OR');
    expect(rows[1]!.measure).toBe('RR');
    expect(rows[0]!.sampleSize).toBeUndefined();
    expect(rows[1]!.sampleSize).toBeUndefined();
  });

  it('rejects a row where the point estimate sits outside the CI', () => {
    const question = 'Bad trial: HR 5.00 (95% CI 0.70-0.90)';
    expect(parsePromptEffectRows(question)).toHaveLength(0);
  });

  it('rejects reversed confidence intervals', () => {
    const question = 'Trial X: HR 0.80 (95% CI 0.90-0.70)';
    expect(parsePromptEffectRows(question)).toHaveLength(0);
  });

  it('does not match bare English words as measures', () => {
    const question = 'Patients had a stroke or 150 events during follow-up.';
    expect(parsePromptEffectRows(question)).toHaveLength(0);
  });

  it('returns empty when no structured rows are found', () => {
    expect(parsePromptEffectRows('Write a paper about diabetes')).toHaveLength(0);
  });
});

describe('toSyntheticExtractions', () => {
  it('produces long-form keyFinding the existing meta-analysis parser can read', () => {
    resetSyntheticIds();
    const rows = [
      { label: 'DAPA-HF', measure: 'HR' as const, point: 0.74, ciLow: 0.65, ciHigh: 0.85, sampleSize: 4744 },
      { label: 'EMPEROR-Reduced', measure: 'HR' as const, point: 0.80, ciLow: 0.72, ciHigh: 0.89, sampleSize: 3730 },
    ];
    const extractions = toSyntheticExtractions(rows);
    expect(extractions).toHaveLength(2);
    expect(extractions[0]!.sourceMarker).toBe('[P1]');
    expect(extractions[0]!.keyFinding).toContain('hazard ratio');
    expect(extractions[0]!.keyFinding).toContain('0.74');
    expect(extractions[0]!.keyFinding).toContain('95% CI');
    expect(extractions[0]!.sampleSize).toBe('n=4744');
    expect(extractions[0]!.trusted).toBe(true);
    expect(extractions[0]!.evidenceIndex).toBeLessThan(0);
  });
});
