// Association Confidence — the deterministic "percentage" for Genetics mode.
//
// CRITICAL: this score is computed in code from real retrieved evidence, never
// written by the language model. It expresses the STRENGTH OF THE PUBLISHED
// ASSOCIATION between a variant and a disease — it is NOT a personal clinical
// risk estimate. Inputs are structured data points lifted verbatim from GWAS
// Catalog (odds ratio / CI / p-value) and ClinVar (clinical significance); the
// model only narrates the result and its citations.

import type { EvidenceItem } from '@platform/index';
import { extractEffectValues } from '../effectExtraction';
import {
  diseaseTerms,
  extractUnrecognizedGeneTokens,
  hasGeneSignal,
} from './geneQueryReadiness';
import { genesForQuestion } from './variantGenes';

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
  /** The significance came from a real quantitative effect size (an odds/risk/
   *  hazard ratio with a p-value or CI), not just a clinical classification. The
   *  top "very strong" band requires this so a band can never outrun the data. */
  quantitative?: boolean;
  /** The reported ratio (OR/RR/HR) on its natural scale, where 1 is the null. A
   *  significant OR of 1.3 is far weaker evidence of a link than an OR of 24, and
   *  the score must reflect that. Absent for classification-only records. */
  effect?: number;
  /** The record is an evidence synthesis (meta-analysis / systematic review). Such
   *  records pool the SAME underlying primary studies, so counting eight of them as
   *  eight independent observations inflates the score — they are collapsed to one. */
  synthesis?: boolean;
}

export interface AssociationConfidence {
  /** 0–100 strength of the published association (not a personal risk). */
  score: number;
  band: ConfidenceBand;
  /** Points that support a correlation (significant risk or protective). */
  supportCount: number;
  /** Points that refute a correlation (significant neutral/benign). */
  refuteCount: number;
  /** Supporting points backed by a quantitative effect size (OR/RR/HR + stat). */
  quantitativeCount: number;
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

// Effect-magnitude factor. A significant OR of 1.3 and a significant OR of 24 both
// pass a p-value test, but they are not equally strong evidence of a link. Scaled on
// |ln(effect)| against a three-fold effect, floored at 0.3 so a small-but-real effect
// still scores something. Records with no reported ratio (a decisive ClinVar
// classification) are not damped.
// A record that pools other studies rather than reporting a primary observation.
const SYNTHESIS_RX = /\b(meta-?analysis|systematic review|umbrella review|pooled analysis|meta-?analytic)\b/i;

const REFERENCE_EFFECT = Math.log(3);
function magnitudeFactor(effect: number | undefined): number {
  if (effect === undefined || !Number.isFinite(effect) || effect <= 0) return 1;
  const magnitude = Math.abs(Math.log(effect)) / REFERENCE_EFFECT;
  return Math.min(1, Math.max(0.3, magnitude));
}

/** Independent observations among the supporting points. Evidence syntheses reuse the
 *  same primary studies, so they contribute one observation between them however many
 *  were retrieved — eight meta-analyses of the same literature are not eight studies. */
function independentSupportCount(supports: AssociationDataPoint[]): number {
  const primary = supports.filter((p) => !p.synthesis).length;
  const anySynthesis = supports.some((p) => p.synthesis);
  return primary + (anySynthesis ? 1 : 0);
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
      quantitativeCount: 0,
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
  // How large the reported effects actually are, averaged across the supports.
  const effectFactor =
    supports.reduce((sum, p) => sum + magnitudeFactor(p.effect), 0) / supports.length;

  const raw =
    100 *
      supportRatio *
      volumeFactor(independentSupportCount(supports)) *
      tierFactor *
      effectFactor *
      (0.85 + 0.15 * directionConcordance) +
    clinvarBoost;
  let score = Math.round(Math.min(100, Math.max(0, raw)));

  // The "very strong" band must be earned by a quantitative effect size, not by
  // a pile of clinical classifications alone — otherwise a report reads "very
  // strong" while showing "Quantitative evidence: none reported". Without a
  // supporting OR/RR/HR + stat, cap at the top of "strong" (79).
  const quantitativeCount = supports.filter((p) => p.quantitative).length;
  let capNote = '';
  if (score >= 80 && quantitativeCount === 0) {
    score = 79;
    capNote = ' Capped below "very strong" because no quantitative effect size (OR/RR/HR with a CI or p-value) was retrieved — the score rests on clinical classifications and effect direction.';
  }

  // "Strong" is a claim that a curated genetic database records this variant against
  // this disease. Published literature alone — however much of it — cannot carry the
  // top bands: an MTHFR/VTE query once read "75% — strong" from meta-analyses while
  // the report itself noted no GWAS Catalog or ClinVar record linked the two.
  const structuredSupport = supports.some((p) => p.source === 'gwas_catalog' || p.source === 'clinvar');
  if (score >= 60 && !structuredSupport) {
    score = 59;
    capNote +=
      ' Capped below "strong" because no GWAS Catalog or ClinVar record links this variant to the asked disease — the score rests on published literature alone.';
  }

  const pooledDirection: AssociationConfidence['pooledDirection'] =
    directionConcordance < 0.6 ? 'mixed' : risk >= protective ? 'risk' : 'protective';

  const dirText =
    pooledDirection === 'mixed'
      ? `mixed direction (${risk} risk, ${protective} protective)`
      : `consistent ${pooledDirection} direction`;
  const refuteText = refutes.length ? `, with ${refutes.length} non-associating record(s)` : '';
  const quantText = quantitativeCount > 0 ? `, ${quantitativeCount} with a quantitative effect size` : '';
  const rationale = `Based on ${supports.length} significant association record(s) (${dirText})${quantText}${refuteText}.${capNote}`;

  return {
    score,
    band: bandFor(score),
    supportCount: supports.length,
    refuteCount: refutes.length,
    quantitativeCount,
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
    // A literature point always carries a reported ratio, and a SUPPORTING one is
    // significant by a p-value or CI — i.e. a real quantitative effect size.
    quantitative: significant,
    effect: value,
    synthesis: SYNTHESIS_RX.test(text),
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
  // A structured record only supports THIS association when it is recorded against the
  // disease that was asked about. ClinVar names the condition in the record text and
  // was never checked, so MTHFR's homocystinuria classifications counted as support for
  // venous thromboembolism. GWAS is trait-filtered upstream; re-check it here too.
  const onAskedDisease = (record: EvidenceItem): boolean => {
    if (disease.length === 0) return true;
    const hay = `${record.title} ${record.snippet ?? ''}`.toLowerCase();
    return disease.some((term) => hay.includes(term));
  };

  for (const record of evidence) {
    const id = (record.identifiers ?? {}) as Record<string, unknown>;
    if (record.source === 'gwas_catalog' || record.source === 'clinvar') {
      if (!onAskedDisease(record)) continue;
    }
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
        quantitative: true, // GWAS Catalog rows carry an odds ratio + CI/p-value
        effect: or,
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
 *  literature records may contribute (must mention the asked disease).
 *
 *  An association confidence quantifies a GENE-disease link, so it is only meaningful
 *  when the question actually names a gene or variant. A cardiology question once
 *  reached this scorer (its trial acronym was misread as a gene), and its 25
 *  spironolactone papers were scored "65% — strong". With no gene in the question
 *  there is nothing for the score to be about, so report it as insufficient. */
export function confidenceFromEvidence(
  evidence: EvidenceItem[],
  question?: string,
): AssociationConfidence {
  const points = associationPointsFromEvidence(evidence, question);
  if (question !== undefined && !hasGeneSignal(question)) {
    return {
      score: 0,
      band: 'insufficient',
      supportCount: 0,
      refuteCount: 0,
      quantitativeCount: 0,
      totalCount: points.length,
      pooledDirection: 'none',
      rationale:
        'The question names no gene or variant, so the strength of a gene-disease association ' +
        'cannot be quantified from the retrieved records.',
    };
  }
  return associationConfidence(points);
}

// ── Per-gene scoring (multi-gene questions) ────────────────────────────────────

/** One gene named in the question and the app-computed confidence for it. */
export interface GeneAssociation {
  /** The gene symbol as named (empty only for an rsID-only single-gene query). */
  gene: string;
  /** True when the symbol is an approved HGNC gene; false for a made-up token
   *  the question framed as a gene (e.g. "ZXPQ7"), which is never scored. */
  recognized: boolean;
  confidence: AssociationConfidence;
}

// Does a record actually name this gene symbol (title, snippet, or the structured
// gene identifier)? Used to attribute retrieved evidence to the right gene so each
// gene is scored on its OWN records, not the whole multi-gene pool.
export function mentionsGene(record: EvidenceItem, gene: string): boolean {
  const id = (record.identifiers ?? {}) as Record<string, unknown>;
  const idGene = typeof id.gene === 'string' ? id.gene : '';
  const hay = `${record.title} ${record.snippet ?? ''} ${idGene}`.toUpperCase();
  return new RegExp(`(^|[^A-Z0-9])${gene.toUpperCase()}([^A-Z0-9]|$)`).test(hay);
}

// A gene the question invented — not in HGNC — cannot carry a score. Report it as
// insufficient with a plain rationale so the reader sees WHY there is no number.
function unrecognizedGeneConfidence(gene: string): AssociationConfidence {
  return {
    score: 0,
    band: 'insufficient',
    supportCount: 0,
    refuteCount: 0,
    quantitativeCount: 0,
    totalCount: 0,
    pooledDirection: 'none',
    rationale: `"${gene}" is not a recognized human gene symbol (not in the HGNC set), so no gene-disease association can be scored for it.`,
  };
}

/**
 * Score the association confidence for EACH gene the question names, rather than
 * emitting a single number for a whole multi-gene question. A comparative query
 * ("PCSK9 vs APOB vs ZXPQ7") must not stamp one score onto every gene — each real
 * gene is scored on its own records, and a made-up gene is flagged as unrecognized
 * with no score at all.
 *
 * A single-gene (or rsID-only) question keeps the original whole-evidence scoring,
 * so its behaviour is unchanged.
 */
export function geneAssociations(
  evidence: EvidenceItem[],
  question: string,
): GeneAssociation[] {
  const genes = genesForQuestion(question);
  const unrecognized = extractUnrecognizedGeneTokens(question);

  // One real gene and nothing fishy — score over the full evidence set exactly
  // as before, so single-gene reports are untouched.
  if (genes.length <= 1 && unrecognized.length === 0) {
    return [
      {
        gene: genes[0] ?? '',
        recognized: true,
        confidence: confidenceFromEvidence(evidence, question),
      },
    ];
  }

  const results: GeneAssociation[] = [];
  for (const gene of genes) {
    const subset = evidence.filter((r) => mentionsGene(r, gene));
    results.push({
      gene,
      recognized: true,
      confidence: associationConfidence(associationPointsFromEvidence(subset, question)),
    });
  }
  for (const gene of unrecognized) {
    results.push({ gene, recognized: false, confidence: unrecognizedGeneConfidence(gene) });
  }
  return results;
}
