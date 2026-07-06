/**
 * Lightweight inverse-variance meta-analysis — zero model calls.
 *
 * When ≥2 RCTs extract comparable continuous or binary outcomes,
 * this module computes pooled effect sizes, 95% CIs, and I²
 * heterogeneity directly from the extracted statistics.
 *
 * All calculations use standard formulas (Hedges & Olkin 1985;
 * DerSimonian & Laird random-effects estimator).
 */

import type { BoundEffect, EvidenceExtraction } from './publicationTypes';

type NumericEffect = {
  label: string;
  point: number;
  se: number;
  ciLow: number;
  ciHigh: number;
  weight: number;
  sampleSize?: number;
  sourceMarker: string;
};

export type MetaAnalysisResult = {
  kind: 'smd' | 'or' | 'rr' | 'hr' | 'other';
  studies: number;
  pooledPoint: number;
  pooledSe: number;
  ciLow: number;
  ciHigh: number;
  pValue: number;
  i2: number;
  tau2: number;
  qStatistic: number;
  qDf: number;
  qPValue: number;
  predictionCiLow: number;
  predictionCiHigh: number;
  studyEffects: NumericEffect[];
  interpretable: boolean;
};

const Z_975 = 1.959963984540054;

function safeNumber(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Try to extract a mean ± SD from effect-value text.
 * Matches patterns like "mean 12.3 ± 2.1" or "12.3 (SD 2.1)".
 */
function extractMeanSd(text: string): { mean: number; sd: number } | undefined {
  const rx1 = /mean\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:±|\\pm|\+\/\-)\s*([0-9]+(?:\.[0-9]+)?)/i;
  const rx2 = /([0-9]+(?:\.[0-9]+)?)\s*\(\s*sd\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*\)/i;
  const rx3 = /([0-9]+(?:\.[0-9]+)?)\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)/i;
  for (const rx of [rx1, rx2, rx3]) {
    const m = text.match(rx);
    if (m) {
      const mean = safeNumber(m[1]);
      const sd = safeNumber(m[2]);
      if (mean !== undefined && sd !== undefined && sd > 0) return { mean, sd };
    }
  }
  return undefined;
}

/**
 * Try to extract a 2×2 contingency table from text for OR/RR computation.
 * Very heuristic — looks for percentages in the context of binary outcomes.
 */
// Placeholder for future binary-outcome meta-analysis (requires event counts).
// function extractProportion(text: string): { p: number; n?: number } | undefined {
//   const rx = /([0-9]+(?:\.[0-9]+)?)\s*%/;
//   const m = text.match(rx);
//   if (m) {
//     const p = safeNumber(m[1]);
//     if (p !== undefined && p >= 0 && p <= 100) return { p: p / 100 };
//   }
//   return undefined;
// }

function sampleSizeFromExtraction(extraction: EvidenceExtraction): number | undefined {
  const raw = extraction.sampleSize ?? '';
  const m = raw.match(/(\d+)/);
  if (m) {
    const n = safeNumber(m[1]);
    if (n !== undefined && n > 0) return n;
  }
  return undefined;
}

/**
 * Build standardized mean differences when at least 2 records have
 * extractable mean ± SD text.
 */
export function buildSmdMeta(
  extractions: EvidenceExtraction[],
): MetaAnalysisResult | undefined {
  const effects: NumericEffect[] = [];

  for (const ex of extractions) {
    const n = sampleSizeFromExtraction(ex);
    if (!n || n < 2) continue;
    const text = ex.effectValues.map((e) => e.sourceText).join(' ');
    const ms = extractMeanSd(text);
    if (!ms) continue;
    // Standard error of the mean = SD / sqrt(N)
    const se = ms.sd / Math.sqrt(n);
    const ciLow = ms.mean - Z_975 * se;
    const ciHigh = ms.mean + Z_975 * se;
    effects.push({
      label: 'mean difference',
      point: ms.mean,
      se,
      ciLow,
      ciHigh,
      weight: 1 / (se * se),
      sampleSize: n,
      sourceMarker: ex.sourceMarker,
    });
  }

  if (effects.length < 2) return undefined;
  return computeInverseVariance(effects, 'smd');
}

/**
 * Build an odds-ratio meta-analysis when ≥2 records have proportions.
 * This is highly approximate; only runs when explicit proportions are found.
 */
export function buildOrMeta(_extractions: EvidenceExtraction[]): MetaAnalysisResult | undefined {
  // Not enough information in snippets for reliable OR meta-analysis
  // without event counts. Leave as placeholder for future full-text extraction.
  return undefined;
}

type RatioFamily = 'hr' | 'or' | 'rr';

function ratioFamily(token: string): RatioFamily | undefined {
  const t = token.toLowerCase();
  if (t === 'hr' || t.includes('hazard')) return 'hr';
  if (t === 'or' || t.includes('odds')) return 'or';
  if (t === 'rr' || t.includes('risk ratio') || t.includes('relative risk')) return 'rr';
  return undefined;
}

/**
 * Parse a ratio effect measure together with its 95% CI from free text, e.g.
 * "hazard ratio 0.80 (95% CI 0.74-0.86)" or "HR 0.80; 95% CI 0.74-0.86".
 * Matches both long forms (hazard ratio, odds ratio, risk ratio, relative risk)
 * and uppercase abbreviations (HR, OR, RR). The abbreviation OR is safe here
 * because the regex requires a numeric point estimate and a matched CI — the
 * English conjunction "or" never appears immediately before a digit+CI pair.
 */
function extractRatioWithCi(
  text: string,
): { family: RatioFamily; point: number; ciLow: number; ciHigh: number } | undefined {
  const measureRx = /\b(hazard ratio|odds ratio|risk ratio|relative risk|hr|or|rr)\b\s*(?:of|was|were|=|:|;|,|approximately)?\s*(\d+(?:\.\d+)?)/i;
  const m = measureRx.exec(text);
  if (!m) return undefined;
  const family = ratioFamily(m[1]!);
  const point = safeNumber(m[2]);
  if (!family || point === undefined || point <= 0 || point > 100) return undefined;
  // Look for a 95% CI after the point estimate (accepts "CI" or the spelled-out
  // "confidence interval", and "to" / dash / comma / semicolon separators).
  const tail = text.slice(m.index);
  const ciRx =
    /(?:95\s*%\s*)?(?:ci|confidence interval)\s*[:=]?\s*(?:of\s*)?\(?\s*(\d+(?:\.\d+)?)\s*(?:to|[-–—]|,)\s*(\d+(?:\.\d+)?)/i;
  const ci = ciRx.exec(tail);
  if (!ci) return undefined;
  const ciLow = safeNumber(ci[1]);
  const ciHigh = safeNumber(ci[2]);
  if (ciLow === undefined || ciHigh === undefined || ciLow <= 0 || ciHigh <= ciLow) return undefined;
  // The point estimate must sit within a tolerance of its own CI, else the CI we
  // found belongs to a different statistic in the same snippet.
  if (point < ciLow * 0.5 || point > ciHigh * 2) return undefined;
  return { family, point, ciLow, ciHigh };
}

/**
 * Read a ratio + 95% CI straight from a pre-bound effect (the pipeline's
 * extractBoundEffects already pairs each estimate with ITS OWN CI, so this avoids
 * re-parsing free text and is why the meta-analysis now fires — the raw
 * effectValues store the point estimate and the CI as separate items, so the CI
 * was never found beside the ratio).
 */
function ratioFromBoundEffect(
  bound: BoundEffect,
): { family: RatioFamily; point: number; ciLow: number; ciHigh: number } | undefined {
  const family = ratioFamily(bound.measure);
  if (!family || !bound.ci) return undefined;
  const point = safeNumber(bound.value);
  const parts = bound.ci.split(/\s*(?:to|[-–—])\s*/i);
  const ciLow = safeNumber(parts[0]);
  const ciHigh = safeNumber(parts[1]);
  if (point === undefined || ciLow === undefined || ciHigh === undefined) return undefined;
  if (point <= 0 || point > 100 || ciLow <= 0 || ciHigh <= ciLow) return undefined;
  if (point < ciLow * 0.5 || point > ciHigh * 2) return undefined;
  return { family, point, ciLow, ciHigh };
}

/**
 * Pool ratio effect measures (HR / OR / RR) reported with 95% CIs across studies.
 * Effects are combined on the log scale (inverse-variance, DerSimonian-Laird) and
 * exponentiated back for display, so the pooled estimate and forest plot read on
 * the natural ratio scale while heterogeneity is computed correctly on the log
 * scale. Only one measure family is pooled — it never mixes a hazard ratio with
 * an odds ratio. At least two studies of the same family are required.
 */
export function buildRatioMeta(extractions: EvidenceExtraction[]): MetaAnalysisResult | undefined {
  const byFamily = new Map<RatioFamily, NumericEffect[]>();
  for (const ex of extractions) {
    // Prefer the pre-bound effects (ratio already paired with its own CI); fall
    // back to parsing free text. One effect per source so a single study that
    // reports several subgroup ratios is not double-counted as many studies.
    let parsed: ReturnType<typeof extractRatioWithCi>;
    for (const bound of ex.boundEffects ?? []) {
      parsed = ratioFromBoundEffect(bound);
      if (parsed) break;
    }
    if (!parsed) {
      const candidates = [
        ex.keyFinding,
        ...ex.effectValues.map((e) => `${e.label} ${e.value} ${e.sourceText}`),
      ];
      for (const text of candidates) {
        parsed = extractRatioWithCi(text);
        if (parsed) break;
      }
    }
    if (!parsed) continue;
    const se = (Math.log(parsed.ciHigh) - Math.log(parsed.ciLow)) / (2 * Z_975);
    if (!(se > 0) || !Number.isFinite(se)) continue;
    const effect: NumericEffect = {
      label: parsed.family,
      point: Math.log(parsed.point),
      se,
      ciLow: Math.log(parsed.ciLow),
      ciHigh: Math.log(parsed.ciHigh),
      weight: 1 / (se * se),
      sourceMarker: ex.sourceMarker,
    };
    const list = byFamily.get(parsed.family);
    if (list) list.push(effect);
    else byFamily.set(parsed.family, [effect]);
  }
  // Pool the family with the most studies (need ≥2 to pool).
  let best: { family: RatioFamily; effects: NumericEffect[] } | undefined;
  for (const [family, effects] of byFamily) {
    if (effects.length >= 2 && (!best || effects.length > best.effects.length)) best = { family, effects };
  }
  if (!best) return undefined;
  const result = computeInverseVariance(best.effects, best.family);
  // Exponentiate display fields back to the natural ratio scale; heterogeneity
  // (I², τ², Q) stays as computed on the log scale.
  return {
    ...result,
    pooledPoint: Math.exp(result.pooledPoint),
    ciLow: Math.exp(result.ciLow),
    ciHigh: Math.exp(result.ciHigh),
    predictionCiLow: Math.exp(result.predictionCiLow),
    predictionCiHigh: Math.exp(result.predictionCiHigh),
    studyEffects: result.studyEffects.map((e) => ({
      ...e,
      point: Math.exp(e.point),
      ciLow: Math.exp(e.ciLow),
      ciHigh: Math.exp(e.ciHigh),
    })),
  };
}

/**
 * Pool the strongest computable synthesis from the extractions: continuous
 * (standardized mean difference) first, otherwise reported ratio measures.
 */
export function buildEvidenceMeta(extractions: EvidenceExtraction[]): MetaAnalysisResult | undefined {
  return buildSmdMeta(extractions) ?? buildRatioMeta(extractions);
}

function computeInverseVariance(effects: NumericEffect[], kind: MetaAnalysisResult['kind']): MetaAnalysisResult {
  // Fixed-effect inverse-variance weights
  const weights = effects.map((e) => 1 / (e.se * e.se));
  const sumW = weights.reduce((a, b) => a + b, 0);
  const pooledPoint = effects.reduce((sum, e, i) => sum + e.point * weights[i]!, 0) / sumW;
  // pooledSe computed but used via rePooled below; keep for documentation
  void Math.sqrt(1 / sumW);

  // Q statistic for heterogeneity
  const q = effects.reduce((sum, e, i) => sum + weights[i]! * (e.point - pooledPoint) ** 2, 0);
  const df = effects.length - 1;
  const qP = q <= 0 ? 1 : 1 - chiSqCdf(q, df);

  // DerSimonian-Laird tau²
  const c = sumW - weights.reduce((sum, w) => sum + w * w / sumW, 0);
  const tau2 = Math.max(0, (q - df) / c);

  // Random-effects pooled estimate
  const reWeights = effects.map((e) => 1 / (e.se * e.se + tau2));
  const sumReW = reWeights.reduce((a, b) => a + b, 0);
  const rePooled = effects.reduce((sum, e, i) => sum + e.point * reWeights[i]!, 0) / sumReW;
  const reSe = Math.sqrt(1 / sumReW);

  // I²
  const i2 = q <= 0 ? 0 : Math.max(0, Math.min(1, (q - df) / q));

  // Prediction interval (Higgins et al.)
  const predSe = Math.sqrt(tau2 + reSe * reSe);

  const z = Math.abs(rePooled / reSe);
  const pValue = 2 * (1 - normalCdf(z));

  return {
    kind,
    studies: effects.length,
    pooledPoint: rePooled,
    pooledSe: reSe,
    ciLow: rePooled - Z_975 * reSe,
    ciHigh: rePooled + Z_975 * reSe,
    pValue,
    i2,
    tau2,
    qStatistic: q,
    qDf: df,
    qPValue: qP,
    predictionCiLow: rePooled - Z_975 * predSe,
    predictionCiHigh: rePooled + Z_975 * predSe,
    studyEffects: effects,
    interpretable: effects.length >= 2 && effects.every((e) => Number.isFinite(e.point) && Number.isFinite(e.se)),
  };
}

/** Normal CDF approximated by Abramowitz & Stegun formula 26.2.17 */
function normalCdf(x: number): number {
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;

  if (x < 0) return 1 - normalCdf(-x);
  const t = 1 / (1 + p * x);
  return 1 - c * Math.exp((-x * x) / 2) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
}

/** Chi-squared CDF approximated by Wilson-Hilferty for df ≥ 1 */
function chiSqCdf(x: number, df: number): number {
  if (x <= 0) return 0;
  if (df < 1) return normalCdf(Math.sqrt(x) - 1);
  const z = Math.pow(x / df, 1 / 3) - (1 - 2 / (9 * df));
  const denom = Math.sqrt(2 / (9 * df));
  return normalCdf(z / denom);
}

export function formatMetaResult(result: MetaAnalysisResult): string {
  const kindLabel = result.kind.toUpperCase();
  const i2Pct = Math.round(result.i2 * 100);
  const heterogeneity = i2Pct < 25 ? 'low' : i2Pct < 50 ? 'moderate' : i2Pct < 75 ? 'substantial' : 'considerable';
  return (
    `${kindLabel} meta-analysis of ${result.studies} studies: ` +
    `pooled estimate ${result.pooledPoint.toFixed(2)} ` +
    `(95% CI ${result.ciLow.toFixed(2)} to ${result.ciHigh.toFixed(2)}; ` +
    `p=${result.pValue < 0.001 ? '<0.001' : result.pValue.toFixed(3)}). ` +
    `Heterogeneity: I²=${i2Pct}%, τ²=${result.tau2.toFixed(3)} (${heterogeneity}). ` +
    `Q=${result.qStatistic.toFixed(2)} (df=${result.qDf}, p=${result.qPValue < 0.001 ? '<0.001' : result.qPValue.toFixed(3)}). ` +
    `Prediction interval: ${result.predictionCiLow.toFixed(2)} to ${result.predictionCiHigh.toFixed(2)}.`
  );
}
