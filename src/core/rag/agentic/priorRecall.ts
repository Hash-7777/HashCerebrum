/**
 * Prior Recall — turn the agent's accumulated belief state into a short note
 * the answering model can read. This is the other half of closing the loop:
 * learnedPriors lets beliefs influence *ranking*; this lets them influence the
 * *answer*. When the current retrieval touches chunks tied to beliefs the agent
 * has reinforced across earlier runs, we tell the model what it already holds —
 * and, crucially, what is contested — so it can corroborate or challenge prior
 * conclusions instead of researching every query from a blank slate.
 *
 * Pure and deterministic — zero model calls, identical on cloud and Ollama.
 */

import type { BeliefState } from './types';

// A belief must have been reinforced/revised at least this many times to count
// as something the agent "already believes" — a single observation is just one
// claim, not learned knowledge.
const MIN_REVISIONS = 2;
// Above this score a belief reads as corroborated; below the contested floor it
// reads as doubted. Anything with conflicting chunks is contested regardless.
const CORROBORATED_AT = 0.6;
const MAX_RECALLED = 3;
const TEXT_CAP = 120;

function trim(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > TEXT_CAP ? `${clean.slice(0, TEXT_CAP - 1).trimEnd()}…` : clean;
}

/**
 * Summarise the beliefs that the current retrieval set touches into a compact,
 * model-readable note, or null when nothing relevant is recalled.
 */
export function recallPriorBeliefs(hitChunkIds: Iterable<string>, beliefs: BeliefState[]): string | null {
  if (beliefs.length === 0) return null;
  const ids = new Set(hitChunkIds);
  if (ids.size === 0) return null;

  const relevant = beliefs.filter(
    (b) =>
      b.revisionCount >= MIN_REVISIONS &&
      (b.supportingChunks.some((id) => ids.has(id)) || b.conflictingChunks.some((id) => ids.has(id))),
  );
  if (relevant.length === 0) return null;

  // Contested beliefs first (most decision-relevant), then by how reinforced.
  relevant.sort((a, b) => {
    const aContested = a.conflictingChunks.length > 0 ? 1 : 0;
    const bContested = b.conflictingChunks.length > 0 ? 1 : 0;
    if (aContested !== bContested) return bContested - aContested;
    return b.revisionCount - a.revisionCount || b.beliefScore - a.beliefScore;
  });

  const phrases = relevant.slice(0, MAX_RECALLED).map((b) => {
    const pct = Math.round(b.beliefScore * 100);
    const obs = `${b.revisionCount} obs`;
    const contested = b.conflictingChunks.length > 0;
    if (contested) {
      return `"${trim(b.representativeText)}" (CONTESTED — ${pct}% confidence across ${obs})`;
    }
    const stance = b.beliefScore >= CORROBORATED_AT ? 'corroborated' : 'tentative';
    return `"${trim(b.representativeText)}" (${stance}, ${pct}% confidence, ${obs})`;
  });

  return `Prior memory recalls ${phrases.length} related belief${phrases.length === 1 ? '' : 's'}: ${phrases.join('; ')}. Corroborate or challenge these with the current evidence.`;
}
