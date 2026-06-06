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
export function welchTTest(groupA: number[], groupB: number[]): TTestResult | { error: string } {
  const nA = groupA.length;
  const nB = groupB.length;
  if (nA < 2 || nB < 2) {
    return {
      error: `Welch t-test requires at least 2 observations per group (got ${nA} and ${nB})`,
    };
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
export function pearson(x: number[], y: number[]): CorrelationResult | { error: string } {
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
    return {
      error: 'Pearson correlation requires non-zero variance in both variables',
    };
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
export function chiSquareTest(table: number[][]): ChiSquareResult | { error: string } {
  if (table.length === 0 || !table[0]) {
    return { error: 'Chi-square test requires a non-empty contingency table' };
  }
  const rows = table.length;
  const cols = table[0].length;
  const rowSums = table.map((row) => row.reduce((sum, value) => sum + value, 0));
  const colSums = Array.from({ length: cols }, (_, j) =>
    table.reduce((sum, row) => sum + row[j]!, 0),
  );
  const total = rowSums.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return { error: 'Chi-square test requires a non-empty contingency table' };
  }
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

// --- paired tests ----------------------------------------------------------------

export interface PairedTTestResult {
  test: 'paired_t';
  meanDifference: number;
  sdDifference: number;
  n: number;
  tStatistic: number;
  df: number;
  pValue: number;
  ciLow: number;
  ciHigh: number;
  reportText: string;
}

export function pairedTTest(before: number[], after: number[]): PairedTTestResult | null {
  if (before.length !== after.length || before.length < 2) return null;
  const diffs = before.map((b, i) => b - after[i]!);
  const m = mean(diffs);
  const sd = Math.sqrt(sampleVariance(diffs, m));
  const n = diffs.length;
  if (sd === 0) return null;
  const se = sd / Math.sqrt(n);
  const t = m / se;
  const df = n - 1;
  const p = tTwoSidedP(Math.abs(t), df);
  const margin = studentTQuantile(0.975, df) * se;
  return {
    test: 'paired_t',
    meanDifference: m,
    sdDifference: sd,
    n,
    tStatistic: t,
    df,
    pValue: p,
    ciLow: m - margin,
    ciHigh: m + margin,
    reportText: `Paired t-test: mean difference = ${fmt(m)} (SD ${fmt(sd)}), t(${df}) = ${fmt(t)}, p = ${fmtP(p)}, 95% CI [${fmt(m - margin)}, ${fmt(m + margin)}].`,
  };
}

// --- Wilcoxon signed-rank -------------------------------------------------------

export interface WilcoxonResult {
  test: 'wilcoxon_signed_rank';
  n: number;
  wStatistic: number;
  zStatistic: number;
  pValue: number;
  reportText: string;
}

export function wilcoxonSignedRank(before: number[], after: number[]): WilcoxonResult | null {
  if (before.length !== after.length || before.length < 2) return null;
  const diffs = before.map((b, i) => b - after[i]!).filter((d) => d !== 0);
  if (diffs.length < 2) return null;
  const abs = diffs.map((d) => Math.abs(d));
  const { ranks, tieGroups } = rankWithTies(abs);
  let wPos = 0;
  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i]! > 0) wPos += ranks[i]!;
  }
  const n = diffs.length;
  const meanW = (n * (n + 1)) / 4;
  const tieCorrection = tieGroups.reduce((sum, t) => sum + (t ** 3 - t), 0);
  const sdW = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection / 48);
  if (sdW === 0) return null;
  const z = (wPos - meanW) / sdW;
  const p = normalTwoSidedP(Math.abs(z));
  return {
    test: 'wilcoxon_signed_rank',
    n,
    wStatistic: wPos,
    zStatistic: z,
    pValue: p,
    reportText: `Wilcoxon signed-rank: W = ${wPos.toFixed(1)}, Z = ${fmt(z)}, p = ${fmtP(p)} (n = ${n}).`,
  };
}

// --- McNemar's test --------------------------------------------------------------

export interface McNemarResult {
  test: 'mcnemar';
  discordantA: number; // before+ / after-
  discordantB: number; // before- / after+
  n: number;
  chiSquare: number;
  pValue: number;
  reportText: string;
}

export function mcnemarTest(beforePos: boolean[], afterPos: boolean[]): McNemarResult | null {
  if (beforePos.length !== afterPos.length || beforePos.length < 2) return null;
  let a = 0; // +/+
  let b = 0; // +/-
  let c = 0; // -/+
  let d = 0; // -/-
  for (let i = 0; i < beforePos.length; i++) {
    const bp = beforePos[i]!;
    const ap = afterPos[i]!;
    if (bp && ap) a++;
    else if (bp && !ap) b++;
    else if (!bp && ap) c++;
    else d++;
  }
  const discordant = b + c;
  if (discordant === 0) return null;
  // Continuity-corrected McNemar
  const chi = (Math.abs(b - c) - 1) ** 2 / discordant;
  const p = chiSquareUpperP(chi, 1);
  return {
    test: 'mcnemar',
    discordantA: b,
    discordantB: c,
    n: beforePos.length,
    chiSquare: chi,
    pValue: p,
    reportText: `McNemar's test: discordant pairs = ${b} vs ${c}, χ²(1) = ${fmt(chi)}, p = ${fmtP(p)}.`,
  };
}

// --- diagnostic accuracy ---------------------------------------------------------

export interface DiagnosticAccuracyResult {
  test: 'diagnostic_accuracy';
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  sensitivity: number;
  specificity: number;
  ppv: number;
  npv: number;
  lrPositive: number;
  lrNegative: number;
  reportText: string;
}

export function diagnosticAccuracy(tp: number, fp: number, tn: number, fn: number): DiagnosticAccuracyResult | null {
  if (tp + fn === 0 || tn + fp === 0) return null;
  const sens = tp / (tp + fn);
  const spec = tn / (tn + fp);
  const ppv = tp + fp > 0 ? tp / (tp + fp) : Number.NaN;
  const npv = tn + fn > 0 ? tn / (tn + fn) : Number.NaN;
  const lrPos = spec < 1 ? sens / (1 - spec) : Number.NaN;
  const lrNeg = sens < 1 ? (1 - spec) / sens : Number.NaN;
  return {
    test: 'diagnostic_accuracy',
    tp, fp, tn, fn,
    sensitivity: sens,
    specificity: spec,
    ppv,
    npv,
    lrPositive: lrPos,
    lrNegative: lrNeg,
    reportText: `Sensitivity = ${(sens * 100).toFixed(1)}%, Specificity = ${(spec * 100).toFixed(1)}%, PPV = ${(ppv * 100).toFixed(1)}%, NPV = ${(npv * 100).toFixed(1)}%, LR+ = ${fmt(lrPos)}, LR− = ${fmt(lrNeg)}.`,
  };
}

// --- ROC AUC (Mann-Whitney U equivalence) ---------------------------------------

export interface RocAucResult {
  test: 'roc_auc';
  auc: number;
  nPositive: number;
  nNegative: number;
  reportText: string;
}

export function rocAuc(positiveScores: number[], negativeScores: number[]): RocAucResult | null {
  if (positiveScores.length === 0 || negativeScores.length === 0) return null;
  const mw = mannWhitneyU(positiveScores, negativeScores);
  if (!mw) return null;
  // mannWhitneyU returns the smaller U; AUC uses the larger U
  const totalPairs = positiveScores.length * negativeScores.length;
  const uMax = totalPairs - mw.u;
  const auc = uMax / totalPairs;
  return {
    test: 'roc_auc',
    auc,
    nPositive: positiveScores.length,
    nNegative: negativeScores.length,
    reportText: `AUC = ${fmt(auc)} (Mann-Whitney U = ${uMax.toFixed(1)}, p = ${fmtP(mw.pValue)}).`,
  };
}

// --- effect sizes ---------------------------------------------------------------

export interface CohensDResult {
  effect: "cohen_d";
  d: number;
  ciLow: number;
  ciHigh: number;
  interpretation: string;
}

export function cohensD(groupA: number[], groupB: number[]): CohensDResult | null {
  if (groupA.length < 2 || groupB.length < 2) return null;
  const m1 = mean(groupA);
  const m2 = mean(groupB);
  const v1 = sampleVariance(groupA, m1);
  const v2 = sampleVariance(groupB, m2);
  const n1 = groupA.length;
  const n2 = groupB.length;
  const pooledSD = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  if (pooledSD === 0) return null;
  const d = (m1 - m2) / pooledSD;
  const se = Math.sqrt(((n1 + n2) / (n1 * n2)) + (d ** 2) / (2 * (n1 + n2)));
  const ciLow = d - Z_95 * se;
  const ciHigh = d + Z_95 * se;
  const mag = Math.abs(d) < 0.2 ? 'negligible' : Math.abs(d) < 0.5 ? 'small' : Math.abs(d) < 0.8 ? 'medium' : 'large';
  return {
    effect: 'cohen_d',
    d,
    ciLow,
    ciHigh,
    interpretation: `Cohen's d = ${fmt(d)} (${mag}), 95% CI [${fmt(ciLow)}, ${fmt(ciHigh)}].`,
  };
}

export function cramersV(table: number[][]): { v: number; interpretation: string } | null {
  const rows = table.length;
  const cols = table[0]?.length ?? 0;
  if (rows < 2 || cols < 2) return null;
  let total = 0;
  let chiSq = 0;
  const rowSums = new Array(rows).fill(0);
  const colSums = new Array(cols).fill(0);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const val = table[i]![j]!;
      total += val;
      rowSums[i] += val;
      colSums[j] += val;
    }
  }
  if (total === 0) return null;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const expected = (rowSums[i] * colSums[j]) / total;
      if (expected > 0) chiSq += (table[i]![j]! - expected) ** 2 / expected;
    }
  }
  const minDim = Math.min(rows - 1, cols - 1);
  if (minDim === 0) return null;
  const v = Math.sqrt(chiSq / (total * minDim));
  const mag = v < 0.1 ? 'negligible' : v < 0.3 ? 'small' : v < 0.5 ? 'medium' : 'large';
  return { v, interpretation: `Cramer's V = ${fmt(v)} (${mag} association).` };
}

// --- multiple comparison correction ----------------------------------------------

export interface AdjustedPValues {
  method: 'bonferroni' | 'holm' | 'bh_fdr';
  original: number[];
  adjusted: number[];
  rejected: boolean[];
  alpha: number;
}

export function bonferroni(pValues: number[], alpha = 0.05): AdjustedPValues {
  const m = pValues.length;
  const adjusted = pValues.map((p) => Math.min(p * m, 1));
  return {
    method: 'bonferroni',
    original: pValues,
    adjusted,
    rejected: adjusted.map((p) => p < alpha),
    alpha,
  };
}

export function holmBonferroni(pValues: number[], alpha = 0.05): AdjustedPValues {
  const indexed = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const m = pValues.length;
  const adjusted = new Array<number>(m).fill(0);
  let prev = 0;
  for (let k = 0; k < m; k++) {
    const rawP = indexed[k]!.p;
    const adj = Math.min(rawP * (m - k), 1);
    const idx = indexed[k]!.i;
    adjusted[idx] = Math.max(adj, prev);
    prev = adjusted[idx]!;
  }
  return {
    method: 'holm',
    original: pValues,
    adjusted,
    rejected: adjusted.map((p) => p < alpha),
    alpha,
  };
}

export function benjaminiHochberg(pValues: number[], alpha = 0.05): AdjustedPValues {
  const indexed = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const m = pValues.length;
  const adjusted = new Array<number>(m).fill(0);
  for (let k = m - 1; k >= 0; k--) {
    const rawP = indexed[k]!.p;
    const adj = Math.min(rawP * m / (k + 1), 1);
    const idx = indexed[k]!.i;
    adjusted[idx] = k === m - 1 ? adj : Math.min(adj, adjusted[indexed[k + 1]!.i]!);
  }
  return {
    method: 'bh_fdr',
    original: pValues,
    adjusted,
    rejected: adjusted.map((p) => p < alpha),
    alpha,
  };
}

// --- formatting helpers (also used by analysisPlan) -----------------------------

function fmt(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function fmtP(p: number): string {
  if (!Number.isFinite(p)) return 'n/a';
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}
