// Verifying that every statistic in drafted prose is one its cited source
// actually reports.
//
// Two guards live here, and they are deliberately keyed on different things
// because each catches what the other cannot.
//
// The marker-keyed guard builds a Quantitative Evidence Table — for each [S#]
// marker, the set of numeric tokens that source genuinely reports — and removes
// any statistic attributed to a source whose set does not contain it. It is
// fail-safe by construction: it works sentence by sentence, and it acts only
// when the cited source reports at least one other extracted number, since a
// non-empty set proves extraction succeeded and a missing value is therefore a
// real misattribution rather than an extraction gap.
//
// That safety rule is also its blind spot. When a cited source yields no
// statistics at all, the marker guard steps back — so a real number lifted from
// an unrelated study survives, which is how a factor-V mortality "relative risk
// of 15.2" ended up pinned to MTHFR. The gene-keyed guard closes it by asking a
// different question: does any retrieved source that mentions THIS gene report
// this ratio? Keyed on the gene rather than the marker, it fires even against an
// empty table.
//
// Both keep the surrounding claim in words and remove only the number, and both
// return the text byte-for-byte unchanged when there is nothing to remove.

import type { EvidenceItem } from '@platform/index';
import { extractEffectValues } from './effectExtraction';
import { extractGeneSymbols } from './genetics/geneQueryReadiness';
import { mentionsGene } from './genetics/associationConfidence';
import { splitSentences } from './honestyGuard';
import type { EvidenceExtraction } from './publicationTypes';
import { recordText } from './textNormalize';

// ── WS-1: Quantitative Evidence Table (QET) ─────────────────────────────────
// The locked set of statistics that legitimately belong to each source, keyed by
// its [S#] marker. A number may be attributed to a source ONLY if that source
// actually reports it — so the same study can never be cited with two different
// hazard ratios (D3), and a context-free number scraped from one abstract can
// never be pinned to a source that does not contain it (D4).

/** Normalise a numeric token so "0.860", ".86", and "0.86" compare equal. */
function normalizeStatNumber(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value.trim();
}

function addStatTokens(set: Set<string>, text: string | null | undefined): void {
  if (!text) return;
  for (const m of text.matchAll(/[0-9]+(?:\.[0-9]+)?/g)) set.add(normalizeStatNumber(m[0]));
}

/** Build the QET: for each source marker, the set of numeric tokens (ratio point
 *  estimates, CI bounds, and p-values) that source actually reports. */
export function buildQuantEvidenceTable(extractions: EvidenceExtraction[]): Map<string, Set<string>> {
  const qet = new Map<string, Set<string>>();
  for (const extraction of extractions) {
    const values = qet.get(extraction.sourceMarker) ?? new Set<string>();
    for (const bound of extraction.boundEffects ?? []) {
      addStatTokens(values, bound.value);
      addStatTokens(values, bound.ci);
      addStatTokens(values, bound.pValue);
    }
    for (const effect of extraction.effectValues) addStatTokens(values, effect.value);
    qet.set(extraction.sourceMarker, values);
  }
  return qet;
}

export interface UnverifiedStat {
  /** The statistic as written, e.g. "hazard ratio 1.05". */
  sourceText: string;
  /** The markers the sentence cited, e.g. ["[S12]"]. */
  markers: string[];
}

const SENTENCE_MARKER_RX = /\[S\d+\]/g;

/**
 * Statistics in the drafted prose that are attributed (by an inline [S#] marker
 * in the same sentence) to a source whose QET does NOT contain the number — the
 * signature of a misattributed or invented estimate. A statistic is verified only
 * when every numeric token in it appears in the union of the cited sources' sets.
 * Sentences with no citation are not checked (nothing to verify against).
 */
export function findUnverifiedStatistics(
  text: string,
  qet: Map<string, Set<string>>,
): UnverifiedStat[] {
  const out: UnverifiedStat[] = [];
  for (const sentence of splitSentences(text)) {
    const markers = [...new Set(sentence.match(SENTENCE_MARKER_RX) ?? [])];
    if (markers.length === 0) continue;
    const allowed = new Set<string>();
    for (const mk of markers) for (const v of qet.get(mk) ?? []) allowed.add(v);
    for (const stat of extractEffectValues(sentence)) {
      const nums = [...stat.value.matchAll(/[0-9]+(?:\.[0-9]+)?/g)].map((m) => normalizeStatNumber(m[0]));
      if (nums.length === 0) continue;
      if (!nums.every((n) => allowed.has(n))) out.push({ sourceText: stat.sourceText, markers });
    }
  }
  return out;
}

/**
 * WS-1b: remove a statistic that is attributed to a source which does NOT report
 * that number, keeping the surrounding claim in words. Fail-safe by construction:
 * it works sentence by sentence (never removes a number from a different
 * sentence), and it acts ONLY when the cited sources report at least one other
 * extracted statistic — a non-empty locked set proves extraction succeeded for
 * that source, so a missing number is a genuine misattribution rather than an
 * extraction gap. A paragraph with nothing to remove is returned byte-for-byte
 * unchanged. Returns the cleaned text and the removed statistics (for the trace).
 */
export function neutralizeUnverifiedStatistics(
  text: string,
  qet: Map<string, Set<string>>,
): { text: string; removed: string[] } {
  const removed: string[] = [];
  const sentences = splitSentences(text).map((sentence) => {
    const markers = [...new Set(sentence.match(SENTENCE_MARKER_RX) ?? [])];
    if (markers.length === 0) return sentence;
    const allowed = new Set<string>();
    for (const mk of markers) for (const v of qet.get(mk) ?? []) allowed.add(v);
    if (allowed.size === 0) return sentence; // extraction gap — never touch
    let out = sentence;
    for (const stat of extractEffectValues(sentence)) {
      const nums = [...stat.value.matchAll(/[0-9]+(?:\.[0-9]+)?/g)].map((m) => normalizeStatNumber(m[0]));
      if (nums.length === 0 || nums.every((n) => allowed.has(n))) continue;
      const esc = stat.sourceText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const next = out.replace(new RegExp(esc), '');
      if (next !== out) {
        removed.push(stat.sourceText);
        out = next;
      }
    }
    return out;
  });
  if (removed.length === 0) return { text, removed }; // nothing changed — original preserved exactly
  const cleaned = sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    // Tidy the empty parentheses / dangling separators a removed statistic leaves.
    .replace(/\(\s*[,;]?\s*\)/g, '')
    .replace(/\(\s*,\s*/g, '(')
    .replace(/\s*,\s*\)/g, ')')
    .replace(/\s*,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:)])/g, '$1')
    .trim();
  return { text: cleaned, removed };
}

// Effect-magnitude labels emitted by extractEffectValues — the ratios a claim
// pins to a gene. Confidence intervals and p-values are excluded: they qualify a
// ratio rather than assert a gene→magnitude association on their own.
const RATIO_STAT_LABELS = new Set(['odds ratio', 'risk ratio', 'hazard ratio']);

// The effect-magnitude values reported by the retrieved sources that actually
// mention a given gene. This is the app-owned truth about which numbers may sit
// next to which gene, independent of the marker the model happened to cite.
function ratioValuesForGene(gene: string, evidence: EvidenceItem[]): Set<string> {
  const values = new Set<string>();
  for (const record of evidence) {
    if (!mentionsGene(record, gene)) continue;
    for (const effect of extractEffectValues(recordText(record))) {
      if (RATIO_STAT_LABELS.has(effect.label)) values.add(normalizeStatNumber(effect.value));
    }
  }
  return values;
}

function geneInText(gene: string, text: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${gene}([^A-Za-z0-9]|$)`, 'i').test(text);
}

/**
 * Remove an effect magnitude the prose pins to a gene that NO retrieved source
 * mentioning that gene reports. The marker-keyed guard (neutralizeUnverified-
 * Statistics) cannot catch this: when the cited source reports no statistic at
 * all it treats the pairing as an extraction gap and leaves it, so a real number
 * lifted from an unrelated study — a factor-V mortality "relative risk of 15.2"
 * pinned to MTHFR — survives. This guard keys on the GENE instead of the marker,
 * so it fires even against an empty marker table. Sentence-scoped and acts only
 * when the sentence names exactly one query gene and carries a ratio that gene's
 * own sources never report; the surrounding claim is kept in words.
 */
export function neutralizeMisattributedGeneStatistics(
  text: string,
  question: string,
  evidence: EvidenceItem[],
): { text: string; removed: string[] } {
  const genes = extractGeneSymbols(question);
  if (genes.length === 0 || evidence.length === 0) return { text, removed: [] };
  const approved = new Map(genes.map((gene) => [gene, ratioValuesForGene(gene, evidence)] as const));
  const removed: string[] = [];
  const sentences = splitSentences(text).map((sentence) => {
    const named = genes.filter((gene) => geneInText(gene, sentence));
    if (named.length !== 1) return sentence; // no gene, or ambiguous — never judge
    const allowed = approved.get(named[0]!) ?? new Set<string>();
    let out = sentence;
    for (const stat of extractEffectValues(sentence)) {
      if (!RATIO_STAT_LABELS.has(stat.label)) continue;
      const nums = [...stat.value.matchAll(/[0-9]+(?:\.[0-9]+)?/g)].map((m) => normalizeStatNumber(m[0]!));
      if (nums.length === 0 || nums.every((n) => allowed.has(n))) continue;
      const esc = stat.sourceText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const next = out.replace(new RegExp(esc), '');
      if (next !== out) {
        removed.push(stat.sourceText);
        out = next;
      }
    }
    return out;
  });
  if (removed.length === 0) return { text, removed };
  const cleaned = sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\(\s*[,;]?\s*\)/g, '')
    .replace(/\(\s*,\s*/g, '(')
    .replace(/\s*,\s*\)/g, ')')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:)])/g, '$1')
    .trim();
  return { text: cleaned, removed };
}

