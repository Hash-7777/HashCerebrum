// Time-to-event (survival) analysis for the inferential statistics engine:
// Kaplan–Meier estimation, the two-group log-rank test, and Cox proportional-
// hazards regression. Pure and deterministic.
//
// Cox regression maximises the Breslow partial likelihood by Newton–Raphson.
// It reports a `converged` flag — a model that fails to converge degrades to
// an honest result, never a fabricated hazard ratio.

import { chiSquareUpperP, normalTwoSidedP } from './distributions';

const Z_95 = 1.959963984540054; // standard normal 97.5th percentile

// --- Kaplan–Meier -----------------------------------------------------------

export interface KmPoint {
  time: number;
  atRisk: number;
  events: number;
  survival: number;
}

export interface KmCurve {
  label: string;
  n: number;
  events: number;
  medianSurvival: number | null;
  points: KmPoint[];
}

/** Kaplan–Meier survival estimate for one group. event = 1 failed, 0 censored. */
export function kaplanMeier(label: string, times: number[], events: number[]): KmCurve {
  const data = times
    .map((time, i) => ({ time, event: events[i] === 1 ? 1 : 0 }))
    .sort((a, b) => a.time - b.time);
  const eventTimes = [...new Set(data.filter((d) => d.event === 1).map((d) => d.time))].sort(
    (a, b) => a - b,
  );
  const points: KmPoint[] = [];
  let survival = 1;
  let median: number | null = null;
  for (const t of eventTimes) {
    const atRisk = data.filter((d) => d.time >= t).length;
    const failed = data.filter((d) => d.time === t && d.event === 1).length;
    if (atRisk > 0) survival *= 1 - failed / atRisk;
    points.push({ time: t, atRisk, events: failed, survival });
    if (median === null && survival <= 0.5) median = t;
  }
  return {
    label,
    n: data.length,
    events: data.filter((d) => d.event === 1).length,
    medianSurvival: median,
    points,
  };
}

// --- Log-rank test ----------------------------------------------------------

export interface LogRankResult {
  test: 'log_rank';
  chiSquare: number;
  df: number;
  pValue: number;
  hazardRatio: number;
  hrCiLow: number;
  hrCiHigh: number;
  observedA: number;
  expectedA: number;
  observedB: number;
  expectedB: number;
}

/**
 * Two-group log-rank test. The hazard ratio is the observed/expected estimator
 * (group A relative to group B) with a 95% CI from the log-scale variance.
 */
export function logRankTest(
  timesA: number[],
  eventsA: number[],
  timesB: number[],
  eventsB: number[],
): LogRankResult {
  const groupA = timesA.map((time, i) => ({ time, event: eventsA[i] === 1 ? 1 : 0 }));
  const groupB = timesB.map((time, i) => ({ time, event: eventsB[i] === 1 ? 1 : 0 }));
  const eventTimes = [
    ...new Set([...groupA, ...groupB].filter((d) => d.event === 1).map((d) => d.time)),
  ].sort((a, b) => a - b);

  let observedA = 0;
  let expectedA = 0;
  let variance = 0;
  for (const t of eventTimes) {
    const n1 = groupA.filter((d) => d.time >= t).length;
    const n2 = groupB.filter((d) => d.time >= t).length;
    const n = n1 + n2;
    const d1 = groupA.filter((d) => d.time === t && d.event === 1).length;
    const d2 = groupB.filter((d) => d.time === t && d.event === 1).length;
    const d = d1 + d2;
    observedA += d1;
    expectedA += (d * n1) / n;
    if (n > 1) variance += (d * (n1 / n) * (n2 / n) * (n - d)) / (n - 1);
  }

  const totalEvents =
    groupA.filter((d) => d.event === 1).length + groupB.filter((d) => d.event === 1).length;
  const observedB = totalEvents - observedA;
  const expectedB = totalEvents - expectedA;
  if (expectedA <= 0 || expectedB <= 0) {
    throw new Error(
      `Log-rank hazard ratio undefined: zero expected events in a group (expectedA=${expectedA}, expectedB=${expectedB})`,
    );
  }
  const chiSquare = variance > 0 ? (observedA - expectedA) ** 2 / variance : 0;
  const hazardRatio = (observedA / expectedA) / (observedB / expectedB);
  const lnHr = Math.log(hazardRatio);
  const lnHrSe = Math.sqrt(1 / expectedA + 1 / expectedB);

  return {
    test: 'log_rank',
    chiSquare,
    df: 1,
    pValue: chiSquareUpperP(chiSquare, 1),
    hazardRatio,
    hrCiLow: Math.exp(lnHr - Z_95 * lnHrSe),
    hrCiHigh: Math.exp(lnHr + Z_95 * lnHrSe),
    observedA,
    expectedA,
    observedB,
    expectedB,
  };
}

// --- Cox proportional-hazards regression ------------------------------------

export interface CoxSubject {
  time: number;
  event: number; // 1 = event, 0 = censored
  covariates: number[];
}

export interface CoxTermResult {
  name: string;
  coefficient: number;
  hazardRatio: number;
  se: number;
  z: number;
  pValue: number;
  hrCiLow: number;
  hrCiHigh: number;
}

export interface CoxResult {
  test: 'cox_regression';
  terms: CoxTermResult[];
  converged: boolean;
  iterations: number;
  n: number;
  events: number;
  logLikelihood: number;
}

/** Distinct event times paired with the indices of the subjects failing there. */
function eventTimeGroups(subjects: CoxSubject[]): { time: number; deaths: number[] }[] {
  const times = [...new Set(subjects.filter((s) => s.event === 1).map((s) => s.time))].sort(
    (a, b) => a - b,
  );
  return times.map((time) => ({
    time,
    deaths: subjects
      .map((s, i) => (s.event === 1 && s.time === time ? i : -1))
      .filter((i) => i >= 0),
  }));
}

/** Breslow partial log-likelihood of a coefficient vector. Exported for tests. */
export function coxLogLikelihood(subjects: CoxSubject[], beta: number[]): number {
  let logLik = 0;
  for (const { time, deaths } of eventTimeGroups(subjects)) {
    let riskSum = 0;
    for (const s of subjects) {
      if (s.time >= time) riskSum += Math.exp(dot(beta, s.covariates));
    }
    for (const i of deaths) logLik += dot(beta, subjects[i]!.covariates);
    logLik -= deaths.length * Math.log(riskSum);
  }
  return logLik;
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

/** Gauss–Jordan inverse of a small square matrix; null if singular. */
function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const a = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const pivotValue = a[col]![col]!;
    for (let j = 0; j < 2 * n; j += 1) a[col]![j]! /= pivotValue;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r]![col]!;
      for (let j = 0; j < 2 * n; j += 1) a[r]![j]! -= factor * a[col]![j]!;
    }
  }
  return a.map((row) => row.slice(n));
}

/**
 * Cox proportional-hazards regression by Newton–Raphson on the Breslow partial
 * likelihood. Covariates are mean-centred for numerical stability (this leaves
 * the coefficient estimates unchanged). Returns per-covariate hazard ratios
 * with 95% CIs and a `converged` flag.
 */
export function coxRegression(subjects: CoxSubject[], covariateNames: string[]): CoxResult {
  const p = covariateNames.length;
  const n = subjects.length;
  const events = subjects.filter((s) => s.event === 1).length;

  const fail = (converged: boolean, iterations: number): CoxResult => ({
    test: 'cox_regression',
    terms: covariateNames.map((name) => ({
      name,
      coefficient: Number.NaN,
      hazardRatio: Number.NaN,
      se: Number.NaN,
      z: Number.NaN,
      pValue: Number.NaN,
      hrCiLow: Number.NaN,
      hrCiHigh: Number.NaN,
    })),
    converged,
    iterations,
    n,
    events,
    logLikelihood: Number.NaN,
  });

  if (p === 0 || events === 0 || n < p + 1) return fail(false, 0);

  // Mean-centre covariates — Cox coefficients are invariant to this, and it
  // keeps exp(beta·x) from overflowing.
  const means = Array.from({ length: p }, (_, j) =>
    subjects.reduce((sum, s) => sum + s.covariates[j]!, 0) / n,
  );
  const centred: CoxSubject[] = subjects.map((s) => ({
    time: s.time,
    event: s.event,
    covariates: s.covariates.map((value, j) => value - means[j]!),
  }));

  const groups = eventTimeGroups(centred);
  let beta = new Array<number>(p).fill(0);
  let information: number[][] | null = null;
  let converged = false;
  let iterations = 0;
  const MAX_ITER = 50;

  for (let iter = 1; iter <= MAX_ITER; iter += 1) {
    iterations = iter;
    const score = new Array<number>(p).fill(0);
    const info = Array.from({ length: p }, () => new Array<number>(p).fill(0));

    for (const { time, deaths } of groups) {
      let riskSum = 0;
      const weightedX = new Array<number>(p).fill(0);
      const weightedXX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
      for (const s of centred) {
        if (s.time < time) continue;
        const w = Math.exp(dot(beta, s.covariates));
        riskSum += w;
        for (let a = 0; a < p; a += 1) {
          weightedX[a]! += w * s.covariates[a]!;
          for (let b = 0; b < p; b += 1) {
            weightedXX[a]![b]! += w * s.covariates[a]! * s.covariates[b]!;
          }
        }
      }
      const xbar = weightedX.map((value) => value / riskSum);
      const d = deaths.length;
      for (const i of deaths) {
        for (let a = 0; a < p; a += 1) score[a]! += centred[i]!.covariates[a]!;
      }
      for (let a = 0; a < p; a += 1) {
        score[a]! -= d * xbar[a]!;
        for (let b = 0; b < p; b += 1) {
          info[a]![b]! += d * (weightedXX[a]![b]! / riskSum - xbar[a]! * xbar[b]!);
        }
      }
    }

    information = info;
    const inverse = invertMatrix(info);
    if (!inverse) return fail(false, iterations);

    // Newton step: beta <- beta + I^-1 * score.
    const step = inverse.map((row) => dot(row, score));
    for (let a = 0; a < p; a += 1) {
      // Damp implausibly large steps to keep the iteration stable.
      beta[a]! += Math.max(-5, Math.min(5, step[a]!));
    }

    if (Math.max(...score.map((value) => Math.abs(value))) < 1e-7) {
      converged = true;
      break;
    }
  }

  if (!converged || !information) return fail(false, iterations);
  const covariance = invertMatrix(information);
  if (!covariance) return fail(false, iterations);

  const terms: CoxTermResult[] = covariateNames.map((name, j) => {
    const coefficient = beta[j]!;
    const se = Math.sqrt(Math.max(0, covariance[j]![j]!));
    const z = coefficient / se;
    return {
      name,
      coefficient,
      hazardRatio: Math.exp(coefficient),
      se,
      z,
      pValue: normalTwoSidedP(z),
      hrCiLow: Math.exp(coefficient - Z_95 * se),
      hrCiHigh: Math.exp(coefficient + Z_95 * se),
    };
  });

  return {
    test: 'cox_regression',
    terms,
    converged: true,
    iterations,
    n,
    events,
    logLikelihood: coxLogLikelihood(centred, beta),
  };
}
