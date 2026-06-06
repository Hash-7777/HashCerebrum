import { describe, expect, it } from 'vitest';
import {
  chiSquareTest,
  fisherExact2x2,
  mannWhitneyU,
  mantelHaenszel,
  oneWayAnova,
  pearson,
  twoByTwoEffects,
  welchTTest,
} from '../inference';

describe('welchTTest', () => {
  it('computes the mean difference, t, and Welch df', () => {
    const result = welchTTest([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(result).not.toHaveProperty('error');
    expect((result as ReturnType<typeof welchTTest> & { error?: undefined }).meanDifference).toBeCloseTo(-3, 9);
    expect((result as ReturnType<typeof welchTTest> & { error?: undefined }).t).toBeCloseTo(-1.8973666, 6);
    expect((result as ReturnType<typeof welchTTest> & { error?: undefined }).df).toBeCloseTo(5.882353, 5);
    expect((result as ReturnType<typeof welchTTest> & { error?: undefined }).ciLow).toBeLessThan((result as ReturnType<typeof welchTTest> & { error?: undefined }).meanDifference);
    expect((result as ReturnType<typeof welchTTest> & { error?: undefined }).ciHigh).toBeGreaterThan((result as ReturnType<typeof welchTTest> & { error?: undefined }).meanDifference);
  });

  it('gives p ≈ 1 for identical groups and a tiny p for well-separated groups', () => {
    const same = welchTTest([4, 5, 6, 5, 4], [4, 5, 6, 5, 4]);
    expect(same).not.toHaveProperty('error');
    expect((same as ReturnType<typeof welchTTest> & { error?: undefined }).t).toBeCloseTo(0, 9);
    expect((same as ReturnType<typeof welchTTest> & { error?: undefined }).pValue).toBeCloseTo(1, 6);
    const apart = welchTTest([1, 2, 1, 2, 1, 2], [50, 51, 50, 51, 50, 51]);
    expect(apart).not.toHaveProperty('error');
    expect((apart as ReturnType<typeof welchTTest> & { error?: undefined }).pValue).toBeLessThan(1e-6);
  });

  it('returns a structured error when either group has fewer than 2 observations', () => {
    const result = welchTTest([1], [2, 3, 4]);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('at least 2 observations');
  });
});

describe('oneWayAnova', () => {
  it('matches a hand-computed three-group example', () => {
    const result = oneWayAnova([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    expect(result.f).toBeCloseTo(27, 9);
    expect(result.dfBetween).toBe(2);
    expect(result.dfWithin).toBe(6);
    expect(result.etaSquared).toBeCloseTo(0.9, 9);
    expect(result.pValue).toBeLessThan(0.01);
  });
});

describe('mannWhitneyU', () => {
  it('handles fully separated groups', () => {
    const result = mannWhitneyU([1, 2, 3, 4], [5, 6, 7, 8]);
    expect(result.u).toBe(0);
    expect(result.z).toBeCloseTo(-2.309401, 5);
    expect(result.pValue).toBeCloseTo(0.0209, 3);
  });
});

describe('pearson', () => {
  it('matches a hand-computed correlation', () => {
    const result = pearson([1, 2, 3, 4], [2, 1, 4, 3]);
    expect(result).not.toHaveProperty('error');
    expect((result as ReturnType<typeof pearson> & { error?: undefined }).r).toBeCloseTo(0.6, 9);
    expect((result as ReturnType<typeof pearson> & { error?: undefined }).df).toBe(2);
    expect((result as ReturnType<typeof pearson> & { error?: undefined }).t).toBeCloseTo(1.0606602, 6);
    expect((result as ReturnType<typeof pearson> & { error?: undefined }).ciLow).toBeLessThan(0.6);
    expect((result as ReturnType<typeof pearson> & { error?: undefined }).ciHigh).toBeGreaterThan(0.6);
  });

  it('returns a structured error when either variable has zero variance', () => {
    const result = pearson([1, 1, 1], [2, 3, 4]);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('zero variance');
  });
});

describe('chiSquareTest', () => {
  it('matches a hand-computed 2×2 table', () => {
    const result = chiSquareTest([
      [10, 20],
      [30, 40],
    ]);
    expect(result).not.toHaveProperty('error');
    expect((result as ReturnType<typeof chiSquareTest> & { error?: undefined }).chiSquare).toBeCloseTo(0.793651, 5);
    expect((result as ReturnType<typeof chiSquareTest> & { error?: undefined }).df).toBe(1);
    expect((result as ReturnType<typeof chiSquareTest> & { error?: undefined }).n).toBe(100);
    expect((result as ReturnType<typeof chiSquareTest> & { error?: undefined }).minExpected).toBeCloseTo(12, 9);
    expect((result as ReturnType<typeof chiSquareTest> & { error?: undefined }).lowExpectedWarning).toBe(false);
  });

  it('flags low expected counts', () => {
    const result = chiSquareTest([
      [1, 2],
      [3, 4],
    ]);
    expect(result).not.toHaveProperty('error');
    expect((result as ReturnType<typeof chiSquareTest> & { error?: undefined }).lowExpectedWarning).toBe(true);
  });

  it('returns a structured error for an empty table', () => {
    const result = chiSquareTest([]);
    expect(result).toHaveProperty('error');
  });

  it('returns a structured error when the table has no data', () => {
    const result = chiSquareTest([
      [0, 0],
      [0, 0],
    ]);
    expect(result).toHaveProperty('error');
  });
});

describe('fisherExact2x2', () => {
  it('matches the tea-tasting reference (two-sided p = 34/70)', () => {
    expect(fisherExact2x2(3, 1, 1, 3).pValue).toBeCloseTo(34 / 70, 9);
  });

  it('returns p = 1 when the table is perfectly balanced', () => {
    expect(fisherExact2x2(5, 5, 5, 5).pValue).toBeCloseTo(1, 9);
  });
});

describe('twoByTwoEffects', () => {
  it('computes OR, RR, and RD with no zero-cell correction', () => {
    const result = twoByTwoEffects(10, 20, 5, 25);
    expect(result.zeroCellCorrection).toBe(false);
    expect(result.oddsRatio).toBeCloseTo(2.5, 9);
    expect(result.riskRatio).toBeCloseTo(2, 9);
    expect(result.riskDifference).toBeCloseTo(1 / 6, 9);
    expect(result.orCiLow).toBeLessThan(2.5);
    expect(result.orCiHigh).toBeGreaterThan(2.5);
  });

  it('applies the Haldane–Anscombe correction on a zero cell', () => {
    const result = twoByTwoEffects(0, 10, 5, 5);
    expect(result.zeroCellCorrection).toBe(true);
    expect(Number.isFinite(result.oddsRatio)).toBe(true);
    expect(result.oddsRatio).toBeGreaterThan(0);
  });
});

describe('mantelHaenszel', () => {
  it('pools the odds ratio across strata and reports per-stratum ORs', () => {
    const result = mantelHaenszel([
      { label: 'Stratum 1', a: 10, b: 10, c: 10, d: 10 },
      { label: 'Stratum 2', a: 20, b: 10, c: 10, d: 20 },
    ]);
    expect(result.strata).toHaveLength(2);
    expect(result.strata[0]!.oddsRatio).toBeCloseTo(1, 9);
    expect(result.strata[1]!.oddsRatio).toBeCloseTo(4, 9);
    expect(result.pooledOddsRatio).toBeCloseTo(2.2, 9);
    expect(result.homogeneityDf).toBe(1);
    expect(result.ciLow).toBeLessThan(result.pooledOddsRatio);
    expect(result.ciHigh).toBeGreaterThan(result.pooledOddsRatio);
  });
});
