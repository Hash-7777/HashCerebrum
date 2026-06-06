// Inverse-variance meta-analysis engine with heterogeneity metrics.
// Computes pooled effect size, I², τ², Q statistic, and prediction interval.

export interface StudyEffect {
  id: string;
  effectSize: number; // e.g. log-OR, Cohen's d, hazard ratio
  se: number; // standard error
  n?: number;
  label?: string;
}

export interface MetaAnalysisResult {
  pooledEffect: number;
  pooledSe: number;
  ciLower: number;
  ciUpper: number;
  zScore: number;
  pValue: number;
  qStatistic: number;
  qDf: number;
  i2: number; // 0–100
  tau2: number;
  studies: number;
  predictionLower: number;
  predictionUpper: number;
}

/**
 * Random-effects inverse-variance meta-analysis (DerSimonian-Laird).
 */
export function metaAnalyse(studies: StudyEffect[]): MetaAnalysisResult | { error: string } {
  if (studies.length < 2) return { error: 'Meta-analysis requires at least 2 studies' };
  const valid = studies.filter((s) => s.se > 0 && Number.isFinite(s.effectSize));
  if (valid.length < 2) return { error: 'At least 2 studies must have valid effect sizes and SE > 0' };

  // Fixed-effect weights
  const weights = valid.map((s) => 1 / (s.se * s.se));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const sumWY = valid.map((s, i) => weights[i]! * s.effectSize).reduce((a, b) => a + b, 0);
  const fixedMean = sumWY / sumW;

  // Q statistic (heterogeneity)
  const q = valid
    .map((s, i) => weights[i]! * (s.effectSize - fixedMean) ** 2)
    .reduce((a, b) => a + b, 0);
  const df = valid.length - 1;

  // DerSimonian-Laird tau²
  const c = sumW - weights.reduce((a, b) => a + b * b, 0) / sumW;
  const tau2 = c > 0 ? Math.max(0, (q - df) / c) : 0;

  // Random-effects weights
  const reWeights = valid.map((s) => 1 / (s.se * s.se + tau2));
  const sumRew = reWeights.reduce((a, b) => a + b, 0);
  const pooled =
    valid.map((s, i) => reWeights[i]! * s.effectSize).reduce((a, b) => a + b, 0) / sumRew;
  const pooledVar = 1 / sumRew;
  const pooledSe = Math.sqrt(pooledVar);

  const ciLower = pooled - 1.96 * pooledSe;
  const ciUpper = pooled + 1.96 * pooledSe;
  const zScore = pooled / pooledSe;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));

  // Prediction interval (Higgins et al.)
  const predSe = Math.sqrt(pooledVar + tau2);
  const predictionLower = pooled - 1.96 * predSe;
  const predictionUpper = pooled + 1.96 * predSe;

  // I²
  const i2 = q > df ? ((q - df) / q) * 100 : 0;

  return {
    pooledEffect: pooled,
    pooledSe,
    ciLower,
    ciUpper,
    zScore,
    pValue,
    qStatistic: q,
    qDf: df,
    i2,
    tau2,
    studies: valid.length,
    predictionLower,
    predictionUpper,
  };
}

// Standard normal CDF approximation (Abramowitz & Stegun)
function normalCdf(x: number): number {
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;

  if (x >= 0) {
    const t = 1 / (1 + p * x);
    return 1 - c * Math.exp(-(x * x) / 2) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
  }
  return 1 - normalCdf(-x);
}

/**
 * Forest-plot ready data: study effects + pooled result.
 */
export function forestPlotData(
  studies: StudyEffect[],
  result: MetaAnalysisResult,
): Array<{ id: string; label: string; effect: number; ciLower: number; ciUpper: number; weight: number }> {
  const rows = studies.map((s) => ({
    id: s.id,
    label: s.label ?? s.id,
    effect: s.effectSize,
    ciLower: s.effectSize - 1.96 * s.se,
    ciUpper: s.effectSize + 1.96 * s.se,
    weight: 1 / (s.se * s.se),
  }));
  rows.push({
    id: 'pooled',
    label: 'Pooled (random effects)',
    effect: result.pooledEffect,
    ciLower: result.ciLower,
    ciUpper: result.ciUpper,
    weight: 1 / (result.pooledSe * result.pooledSe),
  });
  return rows;
}
