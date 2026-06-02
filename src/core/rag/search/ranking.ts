// Phase 2 — medical-aware ranking. Pure functions that nudge the hybrid score by
// clinical signal (evidence strength, recency) and de-duplicate near-identical
// results (MMR diversity). All inputs are passed in, so this stays testable and
// free of React/zustand/I-O.

import type { EvidenceStrength, RagChunk, RagSearchHit } from '../types';
import { cosineSim } from './cosine';

// Multiplier by evidence-strength grade. Gentle (±15%) so semantics still lead
// and a strong-but-irrelevant hit never outranks a relevant one.
const STRENGTH_WEIGHT: Record<EvidenceStrength, number> = {
  strong: 1.15, // systematic review / meta-analysis / RCT
  moderate: 1.07, // cohort / registry / prospective
  weak: 1.0, // case report / cross-sectional / preclinical
  context: 0.95, // regulatory label / drug terminology — supportive, not primary
};

export function evidenceStrengthWeight(grade?: EvidenceStrength): number {
  return grade ? STRENGTH_WEIGHT[grade] : 1;
}

// Multiplier by recency. Newer evidence is mildly preferred; very old evidence
// mildly demoted. Unknown year is neutral.
export function recencyWeight(year?: number | string, nowYear: number = new Date().getFullYear()): number {
  const y = typeof year === 'string' ? Number.parseInt(year, 10) : year;
  if (!y || !Number.isFinite(y)) return 1;
  const age = nowYear - y;
  if (age <= 3) return 1.08;
  if (age <= 7) return 1.04;
  if (age <= 15) return 1.0;
  return 0.95;
}

// Source-credibility tier — what makes the memory a TRUSTED library rather than
// a dump. Peer-reviewed biomedical indexes are trusted highest; drug-label /
// terminology sources and free-text answers are supportive only. Gentle (±15%)
// so semantics still lead retrieval.
const SOURCE_TRUST: Record<string, number> = {
  pubmed: 1.15,
  europepmc: 1.12,
  ctgov: 1.1,
  openalex: 1.06,
  openfda: 0.95,
  rxnorm: 0.92,
  answer: 0.9,
};

// Trust multiplier from a chunk's provenance: its source tier and whether it
// carries a resolvable identifier (a record that can be verified is worth more
// in a citable library; PMID outranks DOI). Unknown sources stay neutral.
export function trustWeight(chunk: RagChunk): number {
  let w = SOURCE_TRUST[chunk.source] ?? 1;
  if (chunk.pmid) w *= 1.06;
  else if (chunk.doi) w *= 1.03;
  return w;
}

/** Combined clinical multiplier applied to a chunk's retrieval score:
 *  evidence strength × recency × source/identifier trust. */
export function medicalBoost(chunk: RagChunk, nowYear?: number): number {
  return evidenceStrengthWeight(chunk.evidenceStrength) * recencyWeight(chunk.year, nowYear) * trustWeight(chunk);
}

// Heuristic evidence-strength grade from a record's text + source. Deliberately
// conservative: returns undefined (no boost) when there is no clear signal.
export function classifyEvidenceStrength(text: string, source: string): EvidenceStrength | undefined {
  const t = text.toLowerCase();
  if (/\b(systematic review|meta-analysis|meta analysis|randomi[sz]ed|\brct\b)\b/.test(t)) return 'strong';
  if (/\b(cohort|registry|prospective|longitudinal|case[- ]control)\b/.test(t)) return 'moderate';
  if (/\b(case report|case series|cross[- ]sectional|in vitro|animal study|preclinical)\b/.test(t)) return 'weak';
  if (source === 'openfda' || source === 'rxnorm') return 'context';
  return undefined;
}

/**
 * Maximal Marginal Relevance re-rank: greedily pick the next hit that best
 * balances relevance (`lambda`) against novelty versus already-picked hits
 * (`1 - lambda`), using embedding cosine for similarity. Removes the "six
 * near-identical abstracts" problem. Hits without a vector are treated as
 * maximally novel (similarity 0).
 */
export function mmrRerank(
  hits: RagSearchHit[],
  vectorFor: (id: string) => Float32Array | undefined,
  lambda: number,
  limit: number,
): RagSearchHit[] {
  const selected: RagSearchHit[] = [];
  const pool = [...hits];
  while (selected.length < limit && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const cand = pool[i]!;
      const cv = vectorFor(cand.chunk.id);
      let maxSim = 0;
      if (cv) {
        for (const picked of selected) {
          const pv = vectorFor(picked.chunk.id);
          if (pv) maxSim = Math.max(maxSim, cosineSim(cv, pv));
        }
      }
      const mmr = lambda * cand.score - (1 - lambda) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    selected.push(pool.splice(bestIdx, 1)[0]!);
  }
  return selected;
}
