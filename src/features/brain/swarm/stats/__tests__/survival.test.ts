import { describe, expect, it } from 'vitest';
import {
  coxLogLikelihood,
  coxRegression,
  kaplanMeier,
  logRankTest,
  type CoxSubject,
} from '../survival';

describe('kaplanMeier', () => {
  it('computes the step survival function with no censoring', () => {
    const curve = kaplanMeier('All', [2, 4, 6], [1, 1, 1]);
    const survival = curve.points.map((p) => p.survival);
    expect(survival[0]).toBeCloseTo(2 / 3, 9);
    expect(survival[1]).toBeCloseTo(1 / 3, 9);
    expect(survival[2]).toBeCloseTo(0, 9);
    expect(curve.medianSurvival).toBe(4);
    expect(curve.events).toBe(3);
  });

  it('skips censored observations as steps but keeps them at risk', () => {
    const curve = kaplanMeier('All', [1, 2, 3], [1, 0, 1]);
    expect(curve.points).toHaveLength(2);
    expect(curve.points[0]!.survival).toBeCloseTo(2 / 3, 9);
    expect(curve.points[0]!.atRisk).toBe(3);
    expect(curve.events).toBe(2);
  });
});

describe('logRankTest', () => {
  it('matches a hand-computed two-group example', () => {
    const result = logRankTest([1, 2, 3], [1, 1, 1], [4, 5, 6], [1, 1, 1]);
    expect(result.observedA).toBe(3);
    expect(result.expectedA).toBeCloseTo(1.15, 9);
    expect(result.chiSquare).toBeCloseTo(5.051661, 5);
    expect(result.hazardRatio).toBeCloseTo(4.217391, 5);
    expect(result.pValue).toBeGreaterThan(0.02);
    expect(result.pValue).toBeLessThan(0.03);
  });
});

describe('coxLogLikelihood', () => {
  it('matches the closed form at beta = 0', () => {
    const subjects: CoxSubject[] = [
      { time: 1, event: 1, covariates: [1] },
      { time: 2, event: 1, covariates: [0] },
      { time: 3, event: 1, covariates: [1] },
      { time: 4, event: 1, covariates: [0] },
      { time: 5, event: 0, covariates: [1] },
      { time: 6, event: 0, covariates: [0] },
    ];
    // L(0) = -(ln6 + ln5 + ln4 + ln3)
    expect(coxLogLikelihood(subjects, [0])).toBeCloseTo(
      -(Math.log(6) + Math.log(5) + Math.log(4) + Math.log(3)),
      9,
    );
  });
});

describe('coxRegression', () => {
  const subjects: CoxSubject[] = [
    { time: 1, event: 1, covariates: [1] },
    { time: 2, event: 1, covariates: [0] },
    { time: 3, event: 1, covariates: [1] },
    { time: 4, event: 1, covariates: [0] },
    { time: 5, event: 0, covariates: [1] },
    { time: 6, event: 0, covariates: [0] },
  ];

  it('converges and returns the partial-likelihood maximum', () => {
    const fit = coxRegression(subjects, ['exposure']);
    expect(fit.converged).toBe(true);
    expect(fit.terms).toHaveLength(1);
    const beta = fit.terms[0]!.coefficient;
    // The higher-covariate subjects fail earlier → positive coefficient, HR > 1.
    expect(beta).toBeGreaterThan(0);
    expect(fit.terms[0]!.hazardRatio).toBeCloseTo(Math.exp(beta), 9);
    // beta-hat must be a maximum of the Breslow partial log-likelihood.
    const atMax = coxLogLikelihood(subjects, [beta]);
    expect(atMax).toBeGreaterThanOrEqual(coxLogLikelihood(subjects, [beta - 0.1]));
    expect(atMax).toBeGreaterThanOrEqual(coxLogLikelihood(subjects, [beta + 0.1]));
    expect(fit.logLikelihood).toBeCloseTo(atMax, 6);
    expect(fit.terms[0]!.se).toBeGreaterThan(0);
  });

  it('fits a two-covariate model and reports both terms', () => {
    const multi: CoxSubject[] = [
      { time: 1, event: 1, covariates: [1, 22] },
      { time: 2, event: 1, covariates: [0, 35] },
      { time: 3, event: 1, covariates: [1, 41] },
      { time: 4, event: 1, covariates: [0, 28] },
      { time: 5, event: 0, covariates: [1, 55] },
      { time: 6, event: 0, covariates: [0, 47] },
      { time: 7, event: 1, covariates: [1, 33] },
      { time: 8, event: 0, covariates: [0, 60] },
    ];
    const fit = coxRegression(multi, ['exposure', 'age']);
    expect(fit.converged).toBe(true);
    expect(fit.terms).toHaveLength(2);
    for (const term of fit.terms) {
      expect(Number.isFinite(term.coefficient)).toBe(true);
      expect(term.se).toBeGreaterThan(0);
    }
  });

  it('reports non-convergence honestly when there are no events', () => {
    const censored: CoxSubject[] = [
      { time: 1, event: 0, covariates: [1] },
      { time: 2, event: 0, covariates: [0] },
    ];
    const fit = coxRegression(censored, ['exposure']);
    expect(fit.converged).toBe(false);
  });
});
