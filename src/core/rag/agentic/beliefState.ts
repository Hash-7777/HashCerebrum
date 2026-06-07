/**
 * Belief State — persistent confidence tracking per extracted claim.
 *
 * When a claim is extracted from a chunk, we look for an existing belief
 * with a matching fingerprint (stemmed, normalised text). If found, we
 * update its confidence using a Bayesian-lite rule:
 *   - Supporting evidence → increase score
 *   - Conflicting evidence → decrease score
 *   - More evidence overall → confidence becomes more certain (closer to 0 or 1)
 *
 * Zero model calls. Deterministic.
 */

import type { ExtractedClaim } from './claimExtractor';
import type { ClaimConflict } from './conflictDetector';
import type { BeliefState } from './types';

const PRIOR = 0.5;
const SUPPORT_BOOST = 0.08;
const CONFLICT_PENALTY = 0.12;
const MIN_SCORE = 0.05;
const MAX_SCORE = 0.95;
const CONVERGENCE_RATE = 0.04; // how much evidence "hardens" the score

/** Create a normalised fingerprint for deduplication. */
export function claimFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(the|a|an|is|are|was|were|been|have|has|had|do|does|did|will|would|could|should|may|might|can|this|that|these|those|with|from|for|about|into|through|during|before|after|above|below|between|under|again|further|then|once)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function now(): string {
  return new Date().toISOString();
}

function buildStructured(claim: ExtractedClaim): BeliefState['structured'] {
  const s: NonNullable<BeliefState['structured']> = {};
  if (claim.effectLabel !== undefined) s.effectLabel = claim.effectLabel;
  if (claim.effectValue !== undefined) s.effectValue = claim.effectValue;
  if (claim.pValue !== undefined) s.pValue = claim.pValue;
  if (claim.ci !== undefined) s.ci = claim.ci;
  if (claim.sampleSize !== undefined) s.sampleSize = claim.sampleSize;
  return Object.keys(s).length > 0 ? s : undefined;
}

function mergeStructured(
  existing: BeliefState['structured'],
  claim: ExtractedClaim,
): BeliefState['structured'] {
  const s: NonNullable<BeliefState['structured']> = {};
  if (claim.effectLabel !== undefined) s.effectLabel = claim.effectLabel;
  else if (existing?.effectLabel !== undefined) s.effectLabel = existing.effectLabel;
  if (claim.effectValue !== undefined) s.effectValue = claim.effectValue;
  else if (existing?.effectValue !== undefined) s.effectValue = existing.effectValue;
  if (claim.pValue !== undefined) s.pValue = claim.pValue;
  else if (existing?.pValue !== undefined) s.pValue = existing.pValue;
  if (claim.ci !== undefined) s.ci = claim.ci;
  else if (existing?.ci !== undefined) s.ci = existing.ci;
  if (claim.sampleSize !== undefined) s.sampleSize = claim.sampleSize;
  else if (existing?.sampleSize !== undefined) s.sampleSize = existing.sampleSize;
  return Object.keys(s).length > 0 ? s : undefined;
}

export function createBelief(claim: ExtractedClaim): BeliefState {
  const fp = claimFingerprint(claim.text);
  const structured = buildStructured(claim);
  const base: BeliefState = {
    id: crypto.randomUUID(),
    claimFingerprint: fp,
    representativeText: claim.text,
    beliefScore: PRIOR,
    supportingChunks: [claim.sourceChunkId],
    conflictingChunks: [],
    revisionCount: 1,
    firstSeenAt: now(),
    lastUpdatedAt: now(),
  };
  if (structured) base.structured = structured;
  return base;
}

function updateScore(
  score: number,
  supportDelta: number,
  conflictDelta: number,
  totalEvidence: number,
): number {
  // Bayesian-lite: each piece of evidence nudges the score
  let next = score + supportDelta * SUPPORT_BOOST - conflictDelta * CONFLICT_PENALTY;

  // Convergence: more evidence → score moves toward extremes (0 or 1)
  const certainty = Math.min(1, totalEvidence * CONVERGENCE_RATE);
  if (next > PRIOR) {
    next = PRIOR + (next - PRIOR) * (1 + certainty * 0.3);
  } else if (next < PRIOR) {
    next = PRIOR - (PRIOR - next) * (1 + certainty * 0.3);
  }

  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, next));
}

export function mergeBelief(existing: BeliefState, claim: ExtractedClaim, isConflict: boolean): BeliefState {
  const chunkId = claim.sourceChunkId;
  const supportDelta = isConflict ? 0 : 1;
  const conflictDelta = isConflict ? 1 : 0;

  const alreadySupporting = existing.supportingChunks.includes(chunkId);
  const alreadyConflicting = existing.conflictingChunks.includes(chunkId);

  if (!isConflict && alreadySupporting) return existing;
  if (isConflict && alreadyConflicting) return existing;

  const totalEvidence =
    existing.supportingChunks.length + existing.conflictingChunks.length + (alreadySupporting || alreadyConflicting ? 0 : 1);

  const newScore = updateScore(existing.beliefScore, supportDelta, conflictDelta, totalEvidence);

  const merged: BeliefState = {
    ...existing,
    representativeText:
      claim.text.length > existing.representativeText.length ? claim.text : existing.representativeText,
    beliefScore: newScore,
    supportingChunks: isConflict
      ? existing.supportingChunks
      : alreadySupporting
        ? existing.supportingChunks
        : [...existing.supportingChunks, chunkId],
    conflictingChunks: isConflict
      ? alreadyConflicting
        ? existing.conflictingChunks
        : [...existing.conflictingChunks, chunkId]
      : existing.conflictingChunks,
    revisionCount: existing.revisionCount + 1,
    lastUpdatedAt: now(),
  };
  const structured = mergeStructured(existing.structured, claim);
  if (structured) merged.structured = structured;
  return merged;
}

/**
 * Build or update beliefs from a fresh set of claims and conflicts.
 */
export function updateBeliefs(
  existing: BeliefState[],
  claims: ExtractedClaim[],
  conflicts: ClaimConflict[],
): BeliefState[] {
  const byFp = new Map<string, BeliefState>();
  for (const b of existing) byFp.set(b.claimFingerprint, b);

  const conflictIds = new Set<string>();
  for (const c of conflicts) {
    conflictIds.add(c.claimA);
    conflictIds.add(c.claimB);
  }

  for (const claim of claims) {
    const fp = claimFingerprint(claim.text);
    const isConflict = conflictIds.has(claim.id);
    const current = byFp.get(fp);
    if (current) {
      byFp.set(fp, mergeBelief(current, claim, isConflict));
    } else {
      byFp.set(fp, createBelief(claim));
    }
  }

  return [...byFp.values()];
}

export function beliefsForChunk(beliefs: BeliefState[], chunkId: string): BeliefState[] {
  return beliefs.filter((b) => b.supportingChunks.includes(chunkId) || b.conflictingChunks.includes(chunkId));
}

export function topBeliefs(beliefs: BeliefState[], limit = 20): BeliefState[] {
  return [...beliefs]
    .sort((a, b) => b.beliefScore - a.beliefScore || b.revisionCount - a.revisionCount)
    .slice(0, limit);
}
