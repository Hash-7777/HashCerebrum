// Hypothesis tests and effect-size estimators for the inferential statistics
// engine. Pure and deterministic — each function takes parsed numeric input
// and returns a structured result with the estimate, confidence interval, test
// statistic, and p-value. The app computes these; the model only narrates them.

import {
  chiSquareUpperP,
  fUpperP,
  logGamma,
  normalTwoSidedP,
  studentTQuantile,
  tTwoSidedP,
} from './distributions';

const Z_95 = 1.959963984540054; // standard normal 97.5th percentile

// --- shared helpers ---------------------------------------------------------

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Unbiased sample variance (divisor n - 1). */
function sampleVariance(values: number[], m: number): number {
  if (values.length < 2) return 0;
  return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
}

/** Average-rank assignment with tie handling; ranks are 1-based. */
function rankWithTies(values: number[]): { ranks: number[]; tieGroups: number[] } {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  const tieGroups: number[] = [];
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.value === indexed[i]!.value) j += 1;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[indexed[k]!.index] = averageRank;
    if (j > i) tieGroups.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, tieGroups };
}

/** Natural log of the binomial coefficient C(n, k). */
function logChoose(n: number, k: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(k) || n < 0 || k < 0 || !Number.isInteger(n) || !Number.isInteger(k)) {
    throw new Error('logChoose requires non-negative integer arguments');
  }
  if (k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

// --- Welch's two-sample t-test ----------------------------------------------

export interface TTestResult {
  test: 'welch_t';
  nA: number;
  nB: number;
  meanA: number;
  meanB: number;
  meanDifference: number;
  ciLow: number;
  ciHigh: number;
  t: number;
  df: number;
  pValue: number;
}

/** Welch's unequal-variance two-sample t-test on the difference meanA - meanB. */
export function welchTTest(groupA: number[], groupB: number[]): TTestResult {
  const nA = groupA.length;
  const nB = groupB.length;
  if (nA < 2 || nB < 2) {
    throw new Error(
      `Welch t-test requires at least 2 observations per group (got ${nA} and ${nB})`,
    );
  }
  const meanA = mean(groupA);
  const meanB = mean(groupB);
  const varA = sampleVariance(groupA, meanA);
  const varB = sampleVariance(groupB, meanB);
  const seA = varA / nA;
  const seB = varB / nB;
  const se = Math.sqrt(seA + seB);
  const meanDifference = meanA - meanB;
  const t = meanDifference / se;
  // Welch–Satterthwaite degrees of freedom.
  const df = (seA + seB) ** 2 / (seA ** 2 / (nA - 1) + seB ** 2 / (nB - 1));
  const margin = studentTQuantile(0.975, df) * se;
  return {
    test: 'welch_t',
    nA,
    nB,
    meanA,
    meanB,
    meanDifference,
    ciLow: meanDifference - margin,
    ciHigh: meanDifference + margin,
    t,
    df,
    pValue: tTwoSidedP(t, df),
  };
}

// --- One-way ANOVA ----------------------------------------------------------

export interface AnovaResult {
  test: 'one_way_anova';
  groupCount: number;
  totalN: number;
  f: number;
  dfBetween: number;
  dfWithin: number;
  pValue: number;
  etaSquared: number;
}

/** One-way analysis of variance across k >= 2 groups of numeric values. */
export function oneWayAnova(groups: number[][]): AnovaResult {
  const k = groups.length;
  const all = groups.flat();
  const totalN = all.length;
  const grandMean = mean(all);
  let ssBetween = 0;
  let ssWithin = 0;
  for (const group of groups) {
    const groupMean = mean(group);
    ssBetween += group.length * (groupMean - grandMean) ** 2;
    for (const value of group) ssWithin += (value - groupMean) ** 2;
  }
  const dfBetween = k - 1;
  const dfWithin = totalN - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const f = msBetween / msWithin;
  return {
    test: 'one_way_anova',
    groupCount: k,
    totalN,
    f,
    dfBetween,
    dfWithin,
    pValue: fUpperP(f, dfBetween, dfWithin),
    etaSquared: ssBetween / (ssBetween + ssWithin),
  };
}

// --- Mann–Whitney U ---------------------------------------------------------

export interface MannWhitneyResult {
  test: 'mann_whitney_u';
  nA: number;
  nB: number;
  u: number;
  z: number;
  pValue: number;
}

/** Mann–Whitney U test (normal approximation with a tie correction). */
export function mannWhitneyU(groupA: number[], groupB: number[]): MannWhitneyResult {
  const nA = groupA.length;
  const nB = groupB.length;
  const total = nA + nB;
  const { ranks, tieGroups } = rankWithTies([...groupA, ...groupB]);
  let rankSumA = 0;
  for (let i = 0; i < nA; i += 1) rankSumA += ranks[i]!;
  const uA = rankSumA - (nA * (nA + 1)) / 2;
  const meanU = (nA * nB) / 2;
  const tieTerm = tieGroups.reduce((sum, t) => sum + (t ** 3 - t), 0);
  const variance =
    ((nA * nB) / 12) * (total + 1 - tieTerm / (total * (total - 1)));
  const z = variance > 0 ? (uA - meanU) / Math.sqrt(variance) : 0;
  return {
    test: 'mann_whitney_u',
    nA,
    nB,
    u: Math.min(uA, nA * nB - uA),
    z,
    pValue: normalTwoSidedP(z),
  };
}

// --- Pearson correlation ----------------------------------------------------

export interface CorrelationResult {
  test: 'pearson';
  n: number;
  r: number;
  ciLow: number;
  ciHigh: number;
  t: number;
  df: number;
  pValue: number;
}

/** Pearson product-moment correlation with a Fisher z-transform 95% CI. */
export function pearson(x: number[], y: number[]): CorrelationResult {
  const n = Math.min(x.length, y.length);
  const meanX = mean(x);
  const meanY = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i]! - meanX;
    const dy = y[i]! - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) {
    throw new Error(
      'Pearson correlation requires non-zero variance in both variables',
    );
  }
  const r = sxy / Math.sqrt(sxx * syy);
  const df = n - 2;
  const t = r * Math.sqrt(df / (1 - r * r));
  // Fisher z-transform confidence interval.
  const z = Math.atanh(Math.max(-0.999999999999, Math.min(0.999999999999, r)));
  const se = 1 / Math.sqrt(n - 3);
  return {
    test: 'pearson',
    n,
    r,
    ciLow: Math.tanh(z - Z_95 * se),
    ciHigh: Math.tanh(z + Z_95 * se),
    t,
    df,
    pValue: tTwoSidedP(t, df),
  };
}

// --- Chi-square test of independence ----------------------------------------

export interface ChiSquareResult {
  test: 'chi_square';
  chiSquare: number;
  df: number;
  pValue: number;
  n: number;
  minExpected: number;
  lowExpectedWarning: boolean;
}

/** Pearson chi-square test of independence for an r×c table of counts. */
export function chiSquareTest(table: number[][]): ChiSquareResult {
  if (table.length === 0 || !table[0]) {
    throw new Error('Chi-square test requires a non-empty contingency table');
  }
  const rows = table.length;
  const cols = table[0].length;
  const rowSums = table.map((row) => row.reduce((sum, value) => sum + value, 0));
  const colSums = Array.from({ length: cols }, (_, j) =>
    table.reduce((sum, row) => sum + row[j]!, 0),
  );
  const total = rowSums.reduce((sum, value) => sum + value, 0);
  let chiSquare = 0;
  let minExpected = Infinity;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      const expected = (rowSums[i]! * colSums[j]!) / total;
      minExpected = Math.min(minExpected, expected);
      if (expected > 0) chiSquare += (table[i]![j]! - expected) ** 2 / expected;
    }
  }
  const df = (rows - 1) * (cols - 1);
  return {
    test: 'chi_square',
    chiSquare,
    df,
    pValue: chiSquareUpperP(chiSquare, df),
    n: total,
    minExpected,
    lowExpectedWarning: minExpected < 5,
  };
}

// --- Fisher's exact test (2×2) ----------------------------------------------

export interface FisherResult {
  test: 'fisher_exact';
  table: [number, number, number, number];
  pValue: number;
}

/**
 * Two-sided Fisher's exact test for a 2×2 table [[a, b], [c, d]]. Sums the
 * hypergeometric probability of every table at least as extreme as observed.
 */
export function fisherExact2x2(a: number, b: number, c: number, d: number): FisherResult {
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const n = a + b + c + d;
  const logProbAt = (k: number): number =>
    logChoose(row1, k) + logChoose(row2, col1 - k) - logChoose(n, col1);
  const observed = logProbAt(a);
  const kMin = Math.max(0, col1 - row2);
  const kMax = Math.min(col1, row1);
  let pValue = 0;
  for (let k = kMin; k <= kMax; k += 1) {
    const logProb = logProbAt(k);
    // Include every table no more probable than the observed one.
    if (logProb <= observed + 1e-7) pValue += Math.exp(logProb);
  }
  return {
    test: 'fisher_exact',
    table: [a, b, c, d],
    pValue: Math.min(1, pValue),
  };
}

// --- 2×2 effect sizes -------------------------------------------------------

export interface TwoByTwoEffects {
  a: number;
  b: number;
  c: number;
  d: number;
  zeroCellCorrection: boolean;
  oddsRatio: number;
  orCiLow: number;
  orCiHigh: number;
  riskRatio: number;
  rrCiLow: number;
  rrCiHigh: number;
  riskDifference: number;
  rdCiLow: number;
  rdCiHigh: number;
}

/**
 * Effect sizes for a 2×2 table where the exposed group has `a` events and `b`
 * non-events and the unexposed group has `c` and `d`. Odds ratio (Woolf logit
 * CI), risk ratio, and risk difference, each with a 95% CI. A zero cell
 * triggers the Haldane–Anscombe 0.5 continuity correction.
 */
export function twoByTwoEffects(a: number, b: number, c: number, d: number): TwoByTwoEffects {
  const zeroCellCorrection = a === 0 || b === 0 || c === 0 || d === 0;
  const ca = zeroCellCorrection ? a + 0.5 : a;
  const cb = zeroCellCorrection ? b + 0.5 : b;
  const cc = zeroCellCorrection ? c + 0.5 : c;
  const cd = zeroCellCorrection ? d + 0.5 : d;

  const safeProduct = (a: number, b: number): number => {
    if (a > Number.MAX_SAFE_INTEGER / Math.max(1, b)) {
      return Number(BigInt(Math.round(a)) * BigInt(Math.round(b)));
    }
    return a * b;
  };
  const oddsRatio = safeProduct(ca, cd) / safeProduct(cb, cc);
  const lnOrSe = Math.sqrt(1 / ca + 1 / cb + 1 / cc + 1 / cd);
  const lnOr = Math.log(oddsRatio);

  const risk1 = ca / (ca + cb);
  const risk2 = cc / (cc + cd);
  const riskRatio = risk1 / risk2;
  const lnRrSe = Math.sqrt(1 / ca - 1 / (ca + cb) + 1 / cc - 1 / (cc + cd));
  const lnRr = Math.log(riskRatio);

  const riskDifference = risk1 - risk2;
  const rdSe = Math.sqrt(
    (risk1 * (1 - risk1)) / (ca + cb) + (risk2 * (1 - risk2)) / (cc + cd),
  );

  return {
    a,
    b,
    c,
    d,
    zeroCellCorrection,
    oddsRatio,
    orCiLow: Math.exp(lnOr - Z_95 * lnOrSe),
    orCiHigh: Math.exp(lnOr + Z_95 * lnOrSe),
    riskRatio,
    rrCiLow: Math.exp(lnRr - Z_95 * lnRrSe),
    rrCiHigh: Math.exp(lnRr + Z_95 * lnRrSe),
    riskDifference,
    rdCiLow: riskDifference - Z_95 * rdSe,
    rdCiHigh: riskDifference + Z_95 * rdSe,
  };
}

// --- Mantel–Haenszel stratified analysis ------------------------------------

export interface MhStratum {
  label: string;
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface MhStratumResult extends MhStratum {
  n: number;
  oddsRatio: number;
  ciLow: number;
  ciHigh: number;
}

export interface MantelHaenszelResult {
  test: 'mantel_haenszel';
  strata: MhStratumResult[];
  pooledOddsRatio: number;
  ciLow: number;
  ciHigh: number;
  homogeneityChiSquare: number;
  homogeneityDf: number;
  homogeneityP: number;
}

/** Expected count of cell `a` in one stratum under a common odds ratio. */
function breslowDayExpectedA(
  row1: number,
  col1: number,
  n: number,
  psi: number,
): number {
  const row2 = n - row1;
  const aMin = Math.max(0, col1 - row2);
  const aMax = Math.min(row1, col1);
  if (Math.abs(psi - 1) < 1e-9) {
    return (row1 * col1) / n;
  }
  const alpha = 1 - psi;
  const beta = n - row1 - col1 + psi * (row1 + col1);
  const gamma = -psi * row1 * col1;
  const disc = Math.sqrt(Math.max(0, beta * beta - 4 * alpha * gamma));
  const root1 = (-beta + disc) / (2 * alpha);
  const root2 = (-beta - disc) / (2 * alpha);
  // Pick the root that is a feasible cell count.
  for (const root of [root1, root2]) {
    if (root >= aMin - 1e-6 && root <= aMax + 1e-6) return Math.min(aMax, Math.max(aMin, root));
  }
  return (row1 * col1) / n;
}

/**
 * Cochran–Mantel–Haenszel pooled odds ratio across strata, with the Robins–
 * Breslow–Greenland 95% CI and a Breslow–Day test of OR homogeneity. Each
 * stratum's own Woolf-logit odds ratio is returned for the forest plot.
 */
export function mantelHaenszel(strata: MhStratum[]): MantelHaenszelResult {
  const usable = strata.filter((s) => s.a + s.b + s.c + s.d > 0);
  let sumR = 0; // Σ a·d / n
  let sumS = 0; // Σ b·c / n
  let varNum1 = 0;
  let varNum2 = 0;
  let varNum3 = 0;

  const stratumResults: MhStratumResult[] = usable.map((s) => {
    const n = s.a + s.b + s.c + s.d;
    const r = (s.a * s.d) / n;
    const sVal = (s.b * s.c) / n;
    const p = (s.a + s.d) / n;
    const q = (s.b + s.c) / n;
    sumR += r;
    sumS += sVal;
    varNum1 += p * r;
    varNum2 += p * sVal + q * r;
    varNum3 += q * sVal;
    const effects = twoByTwoEffects(s.a, s.b, s.c, s.d);
    return {
      ...s,
      n,
      oddsRatio: effects.oddsRatio,
      ciLow: effects.orCiLow,
      ciHigh: effects.orCiHigh,
    };
  });

  const pooledOddsRatio = sumS > 0 ? sumR / sumS : Number.NaN;
  // Robins–Breslow–Greenland variance of ln(OR_MH).
  const lnVar =
    varNum1 / (2 * sumR * sumR) +
    varNum2 / (2 * sumR * sumS) +
    varNum3 / (2 * sumS * sumS);
  const lnOr = Math.log(pooledOddsRatio);
  const ciLow = Math.exp(lnOr - Z_95 * Math.sqrt(lnVar));
  const ciHigh = Math.exp(lnOr + Z_95 * Math.sqrt(lnVar));

  // Breslow–Day homogeneity test.
  let bdChiSquare = 0;
  let bdDf = 0;
  for (const s of usable) {
    const n = s.a + s.b + s.c + s.d;
    const row1 = s.a + s.b;
    const col1 = s.a + s.c;
    if (row1 === 0 || col1 === 0 || row1 === n || col1 === n) continue;
    const expectedA = breslowDayExpectedA(row1, col1, n, pooledOddsRatio);
    const expectedB = row1 - expectedA;
    const expectedC = col1 - expectedA;
    const expectedD = n - row1 - col1 + expectedA;
    if (expectedA <= 0 || expectedB <= 0 || expectedC <= 0 || expectedD <= 0) continue;
    const varA = 1 / (1 / expectedA + 1 / expectedB + 1 / expectedC + 1 / expectedD);
    bdChiSquare += (s.a - expectedA) ** 2 / varA;
    bdDf += 1;
  }
  bdDf = Math.max(0, bdDf - 1);

  return {
    test: 'mantel_haenszel',
    strata: stratumResults,
    pooledOddsRatio,
    ciLow,
    ciHigh,
    homogeneityChiSquare: bdChiSquare,
    homogeneityDf: bdDf,
    homogeneityP: bdDf > 0 ? chiSquareUpperP(bdChiSquare, bdDf) : Number.NaN,
  };
}
