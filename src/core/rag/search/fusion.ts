// Reciprocal Rank Fusion (RRF) + project weighting. Pure and parameter-light:
// RRF merges ranked lists by rank position, not by raw score, so we never have
// to reconcile the different score scales of lexical TF-IDF and cosine
// similarity. This is what lets the hybrid retriever combine both cleanly.

// Standard RRF damping constant (Cormack et al.). Larger = flatter contribution
// from top ranks; 60 is the widely-used default.
export const RRF_K = 60;

export interface FusedHit {
  id: string;
  score: number;
}

/**
 * Fuse several ranked lists of ids into one score map. Each list is in
 * descending relevance order; an id at position `i` contributes 1/(k+i+1).
 */
export function reciprocalRankFusion(rankedLists: string[][], k: number = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i += 1) {
      const id = list[i]!;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }
  return scores;
}

/**
 * Fuse the ranked lists, multiply each fused score by a per-id weight (used to
 * prefer the active project in cross-project search), and return ids sorted by
 * final score, highest first. `weightOf` returns e.g. 1.0 for the active
 * project and 0.6 for others.
 */
export function fuseAndWeight(
  rankedLists: string[][],
  weightOf: (id: string) => number,
  k: number = RRF_K,
): FusedHit[] {
  const fused = reciprocalRankFusion(rankedLists, k);
  return [...fused.entries()]
    .map(([id, score]) => ({ id, score: score * weightOf(id) }))
    .sort((a, b) => b.score - a.score);
}
