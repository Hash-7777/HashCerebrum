// Association Confidence — the deterministic "percentage" for Genetics mode.
//
// CRITICAL: this score is computed in code from real retrieved evidence, never
// written by the language model. It expresses the STRENGTH OF THE PUBLISHED
// ASSOCIATION between a variant and a disease — it is NOT a personal clinical
// risk estimate. Inputs are structured data points lifted verbatim from GWAS
// Catalog (odds ratio / CI / p-value) and ClinVar (clinical significance); the
// model only narrates the result and its citations.

import type { EvidenceItem } from '@platform/index';
import { extractEffectValues } from '../paperPipeline';
import { diseaseTerms } from './geneQueryReadiness';

export type AssociationSource = 'gwas_catalog' | 'clinvar' | 'literature';
export type AssociationDirection = 'risk' | 'protective' | 'neutral';
export type ConfidenceBand = 'insufficient' | 'weak' | 'moderate' | 'strong' | 'very strong';

/** One normalized association observation extracted from a retrieved record. */
export interface AssociationDataPoint {
  source: AssociationSource;
  /** Significant association signal (p<0.05, or a CI excluding the null, or a
   *  decisive ClinVar classification). */
  significant: boolean;
  /** 'risk'/'protective' = a correlation exists; 'neutral' = no correlation
   *  (e.g. a benign ClinVar classification) — counts against the correlation. */
  direction: AssociationDirection;
}

export interface AssociationConfidence {
  /** 0–100 strength of the published association (not a personal risk). */
  score: number;
  band: ConfidenceBand;
  /** Points that support a correlation (significant risk or protective). */
  supportCount: number;
  /** Points that refute a correlation (significant neutral/benign). */
  refuteCount: number;
  totalCount: number;
  pooledDirection: 'risk' | 'protective' | 'mixed' | 'none';
  rationale: string;
}

// Source trust weights — GWAS Catalog (curated quantitative) ≥ ClinVar (curated
// clinical) ≥ individual literature.
export const SOURCE_TIER: Record<AssociationSource, number> = {
  gwas_catalog: 1.0,
  clinvar: 0.85,
  literature: 0.7,
};

const BANDS: Array<{ min: number; band: ConfidenceBand }> = [
  { min: 80, band: 'very strong' },
  { min: 60, band: 'strong' },
  { min: 40, band: 'moderate' },
  { min: 20, band: 'weak' },
  { min: 0, band: 'insufficient' },
];

export function bandFor(score: number): ConfidenceBand {
  return BANDS.find((b) => score >= b.min)!.band;
}

// Diminishing-returns volume factor: one study is weak; more concordant studies
// raise confidence with diminishing returns. 1→0.42, 2→0.67, 3→0.81, 5→0.94.
function volumeFactor(n: number): number {
  return n <= 0 ? 0 : 1 - Math.exp(-0.55 * n);
}

/**
 * Compute the association-confidence score from normalized data points. Pure and
 * deterministic. Returns an "insufficient" result (score 0) when no significant
 * supporting evidence exists, rather than inventing a number.
 */
export function associationConfidence(points: AssociationDataPoint[]): AssociationConfidence {
  const significant = points.filter((p) => p.significant);
  const supports = significant.filter((p) => p.direction === 'risk' || p.direction === 'protective');
  const refutes = significant.filter((p) => p.direction === 'neutral');
  const risk = supports.filter((p) => p.direction === 'risk').length;
  const protective = supports.filter((p) => p.direction === 'protective').length;

  if (supports.length === 0) {
    return {
      score: 0,
      band: 'insufficient',
      supportCount: 0,
      refuteCount: refutes.length,
      totalCount: points.length,
      pooledDirection: 'none',
      rationale:
        points.length === 0
          ? 'No structured association evidence was retrieved for this variant and disease.'
          : 'No significant published association was found in the retrieved evidence.',
    };
  }

  // Support vs refute (a benign/null classification weakens the correlation).
  const supportRatio = supports.length / (supports.length + refutes.length);
  // Average source trust across the supporting points.
  const tierFactor =
    supports.reduce((sum, p) => sum + SOURCE_TIER[p.source], 0) / supports.length;
  // Direction agreement — a mix of risk and protective is less coherent.
  const directionConcordance = Math.max(risk, protective) / (risk + protective);
  // Curated pathogenic/protective ClinVar corroboration adds a small boost.
  const clinvarBoost = supports.some((p) => p.source === 'clinvar') ? 8 : 0;

  const raw =
    100 *
      supportRatio *
      volumeFactor(supports.length) *
      tierFactor *
      (0.85 + 0.15 * directionConcordance) +
    clinvarBoost;
  const score = Math.round(Math.min(100, Math.max(0, raw)));

  const pooledDirection: AssociationConfidence['pooledDirection'] =
    directionConcordance < 0.6 ? 'mixed' : risk >= protective ? 'risk' : 'protective';

  const dirText =
    pooledDirection === 'mixed'
      ? `mixed direction (${risk} risk, ${protective} protective)`
      : `consistent ${pooledDirection} direction`;
  const refuteText = refutes.length ? `, with ${refutes.length} non-associating record(s)` : '';
  const rationale = `Based on ${supports.length} significant association record(s) (${dirText})${refuteText}.`;

  return {
    score,
    band: bandFor(score),
    supportCount: supports.length,
    refuteCount: refutes.length,
    totalCount: points.length,
    pooledDirection,
    rationale,
  };
}

// ── Building data points from retrieved evidence (deterministic, no model) ─────

function parseCi(ci: unknown): [number, number] | null {
  if (typeof ci !== 'string') return null;
  // Two positive bounds separated by a hyphen/dash, e.g. "[1.10-1.84]". The
  // separator must not be read as a negative sign (odds-ratio CIs are positive).
  const m = ci.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

const RATIO_LABELS = new Set(['odds ratio', 'risk ratio', 'hazard ratio']);

// Does a 95% CI string (e.g. "1.10-1.84") exclude the null value of 1?
function ciExcludesOne(value: string): boolean {
  const ci = parseCi(value);
  return ci ? ci[0] > 1 || ci[1] < 1 : false;
}

// Derive an association point from a literature record's reported statistics.
// Uses the shared (WS2-guarded) effect extractor over the title + snippet, so a
// significant published odds/risk/hazard ratio counts toward the score even when
// no GWAS Catalog / ClinVar row exists — but only for a record that mentions the
// asked disease, so an off-topic ratio cannot inflate the result.
function literaturePoint(record: EvidenceItem, disease: string[]): AssociationDataPoint | null {
  const text = `${record.title} ${record.snippet ?? ''}`;
  if (disease.length > 0) {
    const hay = text.toLowerCase();
    if (!disease.some((d) => hay.includes(d))) return null;
  }
  const effects = extractEffectValues(text);
  const ratio = effects.find((e) => RATIO_LABELS.has(e.label));
  if (!ratio) return null;
  const value = Number(ratio.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  const significant =
    effects.some((e) => e.label === 'p-value' && Number(e.value) < 0.05) ||
    effects.some((e) => e.label === 'confidence interval' && ciExcludesOne(e.value));
  return {
    source: 'literature',
    significant,
    direction: value > 1 ? 'risk' : value < 1 ? 'protective' : 'neutral',
  };
}

// ClinVar significance → a decisive correlation signal, or null when uncertain.
function clinvarPoint(significance: string): AssociationDataPoint | null {
  const s = significance.toLowerCase();
  if (/pathogenic|risk factor|\baffects\b|association|established risk/.test(s)) {
    return { source: 'clinvar', significant: true, direction: 'risk' };
  }
  if (/protective/.test(s)) {
    return { source: 'clinvar', significant: true, direction: 'protective' };
  }
  if (/benign/.test(s)) {
    return { source: 'clinvar', significant: true, direction: 'neutral' };
  }
  return null; // uncertain significance / not provided → not a decisive signal
}

/**
 * Convert retrieved EvidenceItems into association data points using ONLY the
 * structured identifier fields the genetic-database sources populate — so the
 * score never depends on free-text parsing or the model. GWAS Catalog gives
 * odds ratio + CI + p-value; ClinVar gives clinical significance.
 */
export function associationPointsFromEvidence(
  evidence: EvidenceItem[],
  question?: string,
): AssociationDataPoint[] {
  const points: AssociationDataPoint[] = [];
  const disease = question ? diseaseTerms(question) : [];
  const num = (v: unknown): number | null => {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  for (const record of evidence) {
    const id = (record.identifiers ?? {}) as Record<string, unknown>;
    if (record.source === 'gwas_catalog') {
      const or = num(id.oddsRatio);
      const p = num(id.pValue);
      const ci = parseCi(id.ci);
      if (or === null || or <= 0) continue; // beta-only records skipped in v1
      const ciExcludesNull = ci ? ci[0] > 1 || ci[1] < 1 : false;
      const significant = (p !== null && p < 0.05) || ciExcludesNull;
      points.push({
        source: 'gwas_catalog',
        significant,
        direction: or > 1 ? 'risk' : or < 1 ? 'protective' : 'neutral',
      });
    } else if (record.source === 'clinvar') {
      const sig = typeof id.clinicalSignificance === 'string' ? id.clinicalSignificance : '';
      const point = clinvarPoint(sig);
      if (point) points.push(point);
    } else {
      // Literature (PubMed / Europe PMC / OpenAlex / imported library): use a
      // significant published effect size when the record is on the asked disease.
      const point = literaturePoint(record, disease);
      if (point) points.push(point);
    }
  }
  return points;
}

/** Convenience: score straight from retrieved evidence. The question gates which
 *  literature records may contribute (must mention the asked disease). */
export function confidenceFromEvidence(
  evidence: EvidenceItem[],
  question?: string,
): AssociationConfidence {
  return associationConfidence(associationPointsFromEvidence(evidence, question));
}
