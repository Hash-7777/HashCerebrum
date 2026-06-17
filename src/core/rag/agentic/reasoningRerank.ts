/**
 * Reasoning Rerank — a final, deterministic rerank stage over already-retrieved
 * hits. RRF + cosine + medical boost + learned priors decide *what* is relevant;
 * this refines the *order* among those candidates by reasoning quality, the kind
 * of signal a cross-encoder reranker would add — but with zero model cost, so it
 * runs the same on Ollama as on cloud models.
 *
 * Three gentle, independent signals:
 *   1. Claim density   — chunks rich in extractable evidence (effect sizes,
 *      sample sizes) are more useful to cite than thin narrative.
 *   2. Conflict salience — a chunk sitting at the centre of a detected
 *      disagreement is decision-relevant and worth surfacing.
 *   3. Source diversity — greedily avoid stacking near-duplicate sources, a
 *      lexical/provenance complement to the embedding-based MMR already applied.
 *
 * Multipliers are gentle (≈ ±15%) so semantic relevance still leads; this
 * reorders ties and near-ties, it never buries a clearly-relevant result.
 */

import type { ExtractedClaim } from './claimExtractor';
import type { RagSearchHit } from '../types';

export interface RerankInput {
  claims: ExtractedClaim[];
  /** Chunk ids that are party to a detected claim conflict. */
  conflictedChunkIds: Set<string>;
  /** How many leading hits to rerank; the tail keeps its order. Default: all. */
  window?: number;
  /** Strength of the source-diversity penalty in [0,1]. Default 0.2. */
  diversityWeight?: number;
}

const CLAIM_DENSITY_MAX = 1.12; // cap of the density bonus
const DENSITY_SATURATION = 6; // claim-weight at which the bonus saturates
const CONFLICT_BONUS = 1.08;

/** Weighted count of extractable claims for a chunk (high worth more). */
function claimWeight(chunkId: string, claims: ExtractedClaim[]): number {
  let w = 0;
  for (const c of claims) {
    if (c.sourceChunkId !== chunkId) continue;
    w += c.confidence === 'high' ? 2 : c.confidence === 'medium' ? 1 : 0.5;
  }
  return w;
}

function reasoningMultiplier(hit: RagSearchHit, input: RerankInput): number {
  const density = Math.min(claimWeight(hit.chunk.id, input.claims), DENSITY_SATURATION);
  const densityMult = 1 + (density / DENSITY_SATURATION) * (CLAIM_DENSITY_MAX - 1);
  const conflictMult = input.conflictedChunkIds.has(hit.chunk.id) ? CONFLICT_BONUS : 1;
  return densityMult * conflictMult;
}

/**
 * Rerank the leading `window` hits by reasoning quality with greedy source
 * de-duplication, leaving any tail untouched. Pure and order-stable for equal
 * scores.
 */
export function reasoningRerank(hits: RagSearchHit[], input: RerankInput): RagSearchHit[] {
  if (hits.length <= 1) return hits;
  const window = Math.min(input.window ?? hits.length, hits.length);
  const diversityWeight = input.diversityWeight ?? 0.2;

  const head = hits.slice(0, window);
  const tail = hits.slice(window);

  const scored = head.map((hit) => ({ hit, base: hit.score * reasoningMultiplier(hit, input) }));

  // Greedy selection: each step picks the best remaining hit after applying a
  // diversity penalty for sources already chosen.
  const selected: RagSearchHit[] = [];
  const usedSources = new Map<string, number>();
  const pool = [...scored];
  while (pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const { hit, base } = pool[i]!;
      const seen = usedSources.get(hit.chunk.source) ?? 0;
      const diversity = 1 / (1 + seen);
      const adjusted = base * (1 - diversityWeight + diversityWeight * diversity);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIdx = i;
      }
    }
    const picked = pool.splice(bestIdx, 1)[0]!;
    selected.push({ ...picked.hit, score: bestScore });
    usedSources.set(picked.hit.chunk.source, (usedSources.get(picked.hit.chunk.source) ?? 0) + 1);
  }

  return [...selected, ...tail];
}

/** Build the set of chunk ids involved in any detected conflict. */
export function conflictedChunkIds(
  claims: ExtractedClaim[],
  conflicts: { claimA: string; claimB: string }[],
): Set<string> {
  const chunkOfClaim = new Map<string, string>();
  for (const c of claims) chunkOfClaim.set(c.id, c.sourceChunkId);
  const ids = new Set<string>();
  for (const conflict of conflicts) {
    const a = chunkOfClaim.get(conflict.claimA);
    const b = chunkOfClaim.get(conflict.claimB);
    if (a) ids.add(a);
    if (b) ids.add(b);
  }
  return ids;
}
