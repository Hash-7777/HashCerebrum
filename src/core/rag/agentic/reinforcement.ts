/**
 * Reinforcement — let explicit user curation teach the learning layer.
 *
 * Belief scores and source-reliability so far only ever moved from raw claim
 * frequency. That is accumulation, not learning: nothing reflected whether the
 * findings were actually any good. The strongest honest signal the app already
 * has is the user's own curation — pruning a finding is an explicit "this was
 * not worth keeping", and undoing a prune is "actually, this was". This module
 * turns those actions into a reward signal that nudges source reliability and
 * the beliefs the affected chunks supported.
 *
 * Pure and deterministic — zero model calls, identical on cloud and Ollama.
 */

import type { BeliefState, SourceReliability } from './types';

export type Reinforcement = 'reward' | 'penalty';

const SOURCE_STEP = 0.05; // reliability nudge per affected chunk
const BELIEF_STEP = 0.06; // belief-score nudge when its support is curated
const MIN_SCORE = 0.05;
const MAX_SCORE = 0.98;

function clamp(n: number): number {
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, n));
}

/**
 * Nudge the reliability of the sources behind a set of curated chunks. Penalty
 * lowers, reward raises. Unknown sources are left untouched — we only adjust a
 * source the agent has actually observed before.
 */
export function reinforceSources(
  map: Record<string, SourceReliability>,
  sources: string[],
  dir: Reinforcement,
): Record<string, SourceReliability> {
  if (sources.length === 0) return map;
  const out = { ...map };
  const delta = dir === 'reward' ? SOURCE_STEP : -SOURCE_STEP;
  const now = new Date().toISOString();
  for (const source of sources) {
    const existing = out[source];
    if (!existing) continue;
    out[source] = { ...existing, score: clamp(existing.score + delta), lastUpdatedAt: now };
  }
  return out;
}

/**
 * Adjust beliefs whose supporting evidence was curated, and drop the references
 * to the affected chunks so beliefs never point at deleted findings. A penalty
 * decays the belief (its support shrank); a reward reinforces it. Beliefs left
 * with no supporting and no conflicting chunks are removed entirely.
 */
export function reinforceBeliefs(
  beliefs: BeliefState[],
  chunkIds: Iterable<string>,
  dir: Reinforcement,
): BeliefState[] {
  const ids = new Set(chunkIds);
  if (ids.size === 0) return beliefs;
  const delta = dir === 'reward' ? BELIEF_STEP : -BELIEF_STEP;
  const now = new Date().toISOString();
  const out: BeliefState[] = [];
  for (const b of beliefs) {
    const touchesSupport = b.supportingChunks.some((id) => ids.has(id));
    const touchesConflict = b.conflictingChunks.some((id) => ids.has(id));
    if (!touchesSupport && !touchesConflict) {
      out.push(b);
      continue;
    }
    // On a penalty (prune) we also forget the removed chunks so the belief does
    // not cite findings that no longer exist; a reward keeps the references.
    const supportingChunks =
      dir === 'penalty' ? b.supportingChunks.filter((id) => !ids.has(id)) : b.supportingChunks;
    const conflictingChunks =
      dir === 'penalty' ? b.conflictingChunks.filter((id) => !ids.has(id)) : b.conflictingChunks;
    if (dir === 'penalty' && supportingChunks.length === 0 && conflictingChunks.length === 0) {
      continue; // belief lost all its evidence — drop it
    }
    out.push({
      ...b,
      // Only the supporting side moves the score; curating a contradicting chunk
      // just updates the references.
      beliefScore: touchesSupport ? clamp(b.beliefScore + delta) : b.beliefScore,
      supportingChunks,
      conflictingChunks,
      revisionCount: b.revisionCount + 1,
      lastUpdatedAt: now,
    });
  }
  return out;
}
