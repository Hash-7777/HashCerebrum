import { describe, expect, it } from 'vitest';
import { getFormFields, computeNewcastleScore, gradeCertainty, gradeToLabel } from '../index';

describe('study design forms', () => {
  it('returns CONSORT fields', () => {
    const fields = getFormFields('consort');
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some((f) => f.id === 'c-randomised')).toBe(true);
  });

  it('returns PRISMA fields', () => {
    const fields = getFormFields('prisma');
    expect(fields.some((f) => f.id === 'p-protocol')).toBe(true);
  });

  it('returns RoB 2 fields with select options', () => {
    const fields = getFormFields('rob2');
    expect(fields[0]!.type).toBe('select');
    expect(fields[0]!.options).toContain('high');
  });

  it('computes Newcastle-Ottawa score', () => {
    const score = computeNewcastleScore({
      'n-representative': '1',
      'n-selection': '1',
      'n-comparability': '2',
    });
    expect(score).toBe(4);
  });

  it('grades certainty high when no downgrades', () => {
    const g = gradeCertainty({
      outcome: 'Mortality',
      studies: 5,
      certainty: 'high',
      riskOfBias: 'not-serious',
      inconsistency: 'not-serious',
      indirectness: 'not-serious',
      imprecision: 'not-serious',
      publicationBias: 'not-serious',
      effectEstimate: 'RR 0.80',
    });
    expect(g).toBe('high');
  });

  it('grades certainty down with biases', () => {
    const g = gradeCertainty({
      outcome: 'Mortality',
      studies: 2,
      certainty: 'high',
      riskOfBias: 'serious',
      inconsistency: 'serious',
      indirectness: 'not-serious',
      imprecision: 'serious',
      publicationBias: 'not-serious',
      effectEstimate: 'RR 0.80',
    });
    expect(g).toBe('very-low');
  });

  it('labels certainty levels', () => {
    expect(gradeToLabel('high')).toContain('Very confident');
    expect(gradeToLabel('very-low')).toContain('Very little confidence');
  });
});
