// Citation-faithfulness audit — the pure, dependency-free core.
//
// HashCerebrum's promise is "no claim without a source". This module extracts
// every cited claim from a manuscript/answer and pairs it with the SNIPPET of
// the record it cites, so a later grading pass can judge whether the source
// actually supports the claim (Supported … Contradicted). Kept pure (no React,
// no LLM, no I/O) so it is fully unit-testable.

import type { EvidenceItem } from '@platform/index';

/** How well a cited source supports the claim that cites it. */
export type FaithfulnessGrade =
  | 'supported'
  | 'weak'
  | 'overstated'
  | 'unsupported'
  | 'contradicted';

export interface ClaimSource {
  /** The citation number as it appears in the body, e.g. 3 for `[3]`. */
  marker: number;
  title: string;
  snippet: string;
}

export interface CitedClaim {
  /** The sentence containing the citation(s). */
  sentence: string;
  /** Distinct citation numbers in the sentence, in order of appearance. */
  markers: number[];
  /** Resolved source records (only those that carry a snippet to verify against). */
  sources: ClaimSource[];
}

const MARKER_RX = /\[(\d{1,3})\]/g;
// A reference-list line ("[1] Author. Title. …") — not a claim to grade.
const REFERENCE_LINE_RX = /^\s*\[\d{1,3}\]\s/;

/**
 * Split text into sentences and return those that carry one or more `[n]`
 * citation markers, with the marker numbers (de-duplicated, in order). Operates
 * on the manuscript BODY — the caller should strip the reference section first;
 * as a safety net, lines shaped like a reference entry are skipped.
 */
export function extractCitedClaims(text: string): Array<{ sentence: string; markers: number[] }> {
  if (!text) return [];
  const out: Array<{ sentence: string; markers: number[] }> = [];
  // Sentence-ish segmentation: a run of non-terminator chars + optional
  // terminator. Good enough for claim extraction (over-splitting is harmless).
  const sentences = text.match(/[^.!?\n]+[.!?]*/g) ?? [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence || REFERENCE_LINE_RX.test(sentence)) continue;
    const markers: number[] = [];
    MARKER_RX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER_RX.exec(sentence)) !== null) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 1 && !markers.includes(n)) markers.push(n);
    }
    if (markers.length > 0) out.push({ sentence, markers });
  }
  return out;
}

/**
 * Resolve each claim's markers to the cited `EvidenceItem` (1-based, matching
 * the renumbered `[n]` order) and keep only sources that carry a snippet to
 * verify against. Claims left with no verifiable source are dropped. Capped to
 * `maxClaims` to bound the cost of the grading pass.
 */
export function pairClaimsToSources(
  claims: Array<{ sentence: string; markers: number[] }>,
  citations: EvidenceItem[],
  maxClaims = 20,
): CitedClaim[] {
  const paired: CitedClaim[] = [];
  for (const claim of claims) {
    const sources: ClaimSource[] = [];
    for (const marker of claim.markers) {
      const record = citations[marker - 1];
      const snippet = record?.snippet?.trim();
      if (record && snippet) sources.push({ marker, title: record.title, snippet });
    }
    if (sources.length > 0) {
      paired.push({ sentence: claim.sentence, markers: claim.markers, sources });
      if (paired.length >= maxClaims) break;
    }
  }
  return paired;
}

/** Convenience: extract + pair in one call. */
export function buildCitedClaims(text: string, citations: EvidenceItem[], maxClaims = 20): CitedClaim[] {
  return pairClaimsToSources(extractCitedClaims(text), citations, maxClaims);
}
