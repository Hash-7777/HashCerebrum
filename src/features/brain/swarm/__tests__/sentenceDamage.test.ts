import { describe, expect, it } from 'vitest';
import { isDamagedSentence } from '../sentenceDamage';

describe('isDamagedSentence', () => {
  it('flags the holes a removed noun leaves', () => {
    for (const s of [
      'The most conceptually ambitious record is, which proposes an integrative account.',
      'Read alongside, it reinforces the case.',
      'The relationships were significant at,, and across the analyses.',
      'Records span 2022 to 2026, with (a review, 2022) the earliest.',
      'The terminology moves, with organised around mid-range ejection fraction, the other records,,.',
      'Each improved outcomes in mildly was associated with a odds ratio of 2.27.',
      ', which frames the field.',
      'The relationships were significant at and across the analyses.',
    ]) {
      expect(isDamagedSentence(s), s).toBe(true);
    }
  });

  it('leaves ordinary sentences alone', () => {
    for (const s of [
      'A pooled analysis reported a reduction in heart failure events [S2].',
      'Most of which were small, single-centre studies.',
      'The trial enrolled adults with diabetes and, in a subgroup, chronic kidney disease.',
      'The hazard ratio was 0.82 (95% CI 0.73 to 0.92).',
      'Benefit was seen in men and women.',
    ]) {
      expect(isDamagedSentence(s), s).toBe(false);
    }
  });
});

describe('isDamagedSentence — parentheticals that are fine', () => {
  it('does not flag "that is," or a list that continues after "or,"', () => {
    expect(isDamagedSentence('The effect held, that is, in both strata.')).toBe(false);
    expect(isDamagedSentence('Patients with diabetes or, less often, obesity were included.')).toBe(false);
  });
});
