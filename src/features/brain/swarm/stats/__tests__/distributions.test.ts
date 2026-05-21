import { describe, expect, it } from 'vitest';
import {
  chiSquareCdf,
  chiSquareUpperP,
  erf,
  fUpperP,
  incompleteBeta,
  incompleteGammaP,
  logGamma,
  normalCdf,
  normalQuantile,
  normalSf,
  normalTwoSidedP,
  studentTCdf,
  tTwoSidedP,
} from '../distributions';

describe('logGamma', () => {
  it('matches factorials: gamma(n) = (n-1)!', () => {
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 9); // 4!
    expect(logGamma(1)).toBeCloseTo(0, 9);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 9);
  });
});

describe('incompleteGammaP', () => {
  it('matches the exponential closed form P(1, x) = 1 - e^-x', () => {
    expect(incompleteGammaP(1, 1)).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(incompleteGammaP(1, 3)).toBeCloseTo(1 - Math.exp(-3), 9);
  });

  it('matches the integer-shape closed form P(3, 2)', () => {
    // Q(3, 2) = e^-2 * (1 + 2 + 2) = 5 e^-2
    expect(incompleteGammaP(3, 2)).toBeCloseTo(1 - 5 * Math.exp(-2), 9);
  });
});

describe('incompleteBeta', () => {
  it('matches the polynomial closed form I_0.5(2, 3) = 0.6875', () => {
    expect(incompleteBeta(2, 3, 0.5)).toBeCloseTo(0.6875, 9);
  });

  it('is the arcsine law for a = b = 1/2', () => {
    expect(incompleteBeta(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 9);
  });

  it('is monotone with the boundary values pinned', () => {
    expect(incompleteBeta(2, 5, 0)).toBe(0);
    expect(incompleteBeta(2, 5, 1)).toBe(1);
  });
});

describe('erf', () => {
  it('matches reference values', () => {
    expect(erf(0)).toBe(0);
    expect(erf(1)).toBeCloseTo(0.8427007929, 8);
    expect(erf(0.5)).toBeCloseTo(0.5204998778, 8);
    expect(erf(-1)).toBeCloseTo(-0.8427007929, 8);
  });
});

describe('normalCdf', () => {
  it('matches reference values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(normalCdf(1)).toBeCloseTo(0.8413447461, 9);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021049, 9);
    expect(normalCdf(-2.5)).toBeCloseTo(0.0062096653, 9);
  });

  it('survival and two-sided p agree with the CDF', () => {
    expect(normalSf(1.96)).toBeCloseTo(0.0249978951, 9);
    expect(normalTwoSidedP(1.959964)).toBeCloseTo(0.05, 6);
  });
});

describe('normalQuantile', () => {
  it('inverts normalCdf at standard points', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959964, 5);
    expect(normalQuantile(0.95)).toBeCloseTo(1.644854, 5);
  });
});

describe('studentTCdf', () => {
  it('is 0.5 at t = 0', () => {
    expect(studentTCdf(0, 10)).toBeCloseTo(0.5, 12);
  });

  it('matches the Cauchy closed form at df = 1', () => {
    expect(studentTCdf(1, 1)).toBeCloseTo(0.75, 9);
  });

  it('produces the textbook two-sided p-value', () => {
    // t = 2.0 on 10 df → two-sided p ≈ 0.0733880
    expect(tTwoSidedP(2, 10)).toBeCloseTo(0.0733880, 6);
    expect(studentTCdf(2, 10)).toBeCloseTo(0.9633060, 6);
  });
});

describe('chiSquare', () => {
  it('matches the closed form for df = 2: cdf = 1 - e^(-x/2)', () => {
    expect(chiSquareCdf(2, 2)).toBeCloseTo(1 - Math.exp(-1), 9);
  });

  it('matches the 5% critical values', () => {
    expect(chiSquareUpperP(3.8414588, 1)).toBeCloseTo(0.05, 5);
    expect(chiSquareUpperP(5.9914645, 2)).toBeCloseTo(0.05, 5);
  });
});

describe('fUpperP', () => {
  it('matches the 5% F critical values', () => {
    expect(fUpperP(3.708265, 3, 10)).toBeCloseTo(0.05, 4);
    expect(fUpperP(2.71089, 5, 20)).toBeCloseTo(0.05, 4);
  });
});
