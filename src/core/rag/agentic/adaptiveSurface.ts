/**
 * Adaptive Surface — re-rank retrieved chunks by reasoning quality.
 *
 * Combines raw retrieval score with:
 * 1. Claim density (chunks with more extractable claims are more useful)
 * 2. Source diversity (penalize chunks from same source)
 * 3. Evidence strength (strong/moderate sources preferred)
 * 4. Conflict awareness (chunks involved in conflicts get a small boost — they represent important disagreement)
 * 5. Coverage contribution (chunks that cover unique query concepts get bonus)
 *
 * Zero model calls. Deterministic re-ranking.
 */

import type { RagChunk, RagSearchHit } from '../types';
import type { ExtractedClaim } from './claimExtractor';
import type { ClaimConflict } from './conflictDetector';
import { conceptGroups } from './coverageAssessor';
import { medicalBoost } from '../search/ranking';

export interface SurfaceOptions {
  query: string;
  claims: ExtractedClaim[];
  conflicts: ClaimConflict[];
  /** Prefer diversity over raw score (0-1). Default 0.25. */
  diversityWeight?: number;
}

function claimDensity(chunk: RagChunk, claims: ExtractedClaim[]): number {
  const chunkClaims = claims.filter((c) => c.sourceChunkId === chunk.id);
  const highConf = chunkClaims.filter((c) => c.confidence === 'high').length;
  const mediumConf = chunkClaims.filter((c) => c.confidence === 'medium').length;
  return highConf * 2 + mediumConf * 1 + 0.5;
}

function sourceDiversityBonus(chunk: RagChunk, selected: RagChunk[]): number {
  const sameSource = selected.filter((s) => s.source === chunk.source && s.title === chunk.title).length;
  return 1 / (1 + sameSource);
}

function coverageContribution(chunk: RagChunk, query: string): number {
  const groups = conceptGroups(query);
  if (groups.length === 0) return 1;
  const text = `${chunk.title} ${chunk.text}`.toLowerCase();
  let covered = 0;
  for (const group of groups) {
    if (group.some((syn) => text.includes(syn))) covered += 1;
  }
  return 1 + (covered / groups.length);
}

function conflictBonus(chunk: RagChunk, conflicts: ClaimConflict[]): number {
  const involved = conflicts.some((c) => c.textA.includes(chunk.id) || c.textB.includes(chunk.id));
  return involved ? 1.15 : 1.0;
}

export function adaptiveSurface(
  hits: RagSearchHit[],
  opts: SurfaceOptions,
): RagSearchHit[] {
  const { query, claims, conflicts, diversityWeight = 0.25 } = opts;

  const scored = hits.map((hit) => {
    const chunk = hit.chunk;
    const baseScore = hit.score;
    const density = claimDensity(chunk, claims);
    const medBoost = medicalBoost(chunk);
    const coverage = coverageContribution(chunk, query);
    const conflict = conflictBonus(chunk, conflicts);

    const reasoningScore = baseScore * density * medBoost * coverage * conflict;
    return { hit, reasoningScore, chunk };
  });

  // Greedy diversity-aware selection
  const selected: RagSearchHit[] = [];
  const pool = scored.sort((a, b) => b.reasoningScore - a.reasoningScore);

  while (pool.length > 0 && selected.length < hits.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < pool.length; i += 1) {
      const item = pool[i]!;
      const diversity = sourceDiversityBonus(item.chunk, selected.map((s) => s.chunk));
      const adjusted = item.reasoningScore * (1 - diversityWeight + diversityWeight * diversity);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIdx = i;
      }
    }

    selected.push(pool.splice(bestIdx, 1)[0]!.hit);
  }

  return selected;
}
