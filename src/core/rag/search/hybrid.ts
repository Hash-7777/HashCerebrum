// Hybrid retrieval: blends the lexical TF-IDF ranking with semantic cosine
// ranking via Reciprocal Rank Fusion, then weights by project so the active
// project ranks first in a cross-project search. Pure (takes its inputs, does
// no I/O) so it can be unit-tested with hand-built vectors.

import type { RagChunk, RagSearchHit } from '../types';
import { cosineSim } from './cosine';
import { fuseAndWeight } from './fusion';
import { lexicalSearch } from './lexical';

export interface HybridInput {
  /** All candidate chunks (cross-project). */
  chunks: RagChunk[];
  query: string;
  /** Query embedding; when absent/empty the search is lexical-only. */
  queryVector?: Float32Array | null;
  /** Returns a chunk's (dequantised) embedding, or undefined if not embedded. */
  vectorFor: (chunkId: string) => Float32Array | undefined;
  /** Active project — its chunks get the full weight; others are down-weighted. */
  activeProjectId?: string | undefined;
  limit: number;
  /** How many candidates each ranker contributes before fusion. */
  candidateK?: number;
  /** Multiplier for chunks outside the active project (default 0.6). */
  otherProjectWeight?: number;
}

export function hybridSearch(input: HybridInput): RagSearchHit[] {
  const { chunks, query, queryVector, vectorFor, activeProjectId, limit } = input;
  if (limit <= 0 || chunks.length === 0) return [];

  const candidateK = input.candidateK ?? Math.max(limit * 5, 50);
  const otherWeight = input.otherProjectWeight ?? 0.6;
  const byId = new Map(chunks.map((c) => [c.id, c]));

  // Lexical ranked ids.
  const lexIds = lexicalSearch(chunks, query, candidateK).map((hit) => hit.chunk.id);

  // Semantic ranked ids (only when we have a query vector).
  let semIds: string[] = [];
  if (queryVector && queryVector.length > 0) {
    const scored: { id: string; score: number }[] = [];
    for (const chunk of chunks) {
      const vec = vectorFor(chunk.id);
      if (!vec) continue;
      scored.push({ id: chunk.id, score: cosineSim(queryVector, vec) });
    }
    scored.sort((a, b) => b.score - a.score);
    semIds = scored.slice(0, candidateK).map((s) => s.id);
  }

  const rankedLists = semIds.length > 0 ? [lexIds, semIds] : [lexIds];
  const weightOf = (id: string): number => {
    if (!activeProjectId) return 1;
    return byId.get(id)?.projectId === activeProjectId ? 1 : otherWeight;
  };

  const hits: RagSearchHit[] = [];
  for (const fused of fuseAndWeight(rankedLists, weightOf)) {
    const chunk = byId.get(fused.id);
    if (!chunk) continue;
    hits.push({ chunk, score: fused.score });
    if (hits.length >= limit) break;
  }
  return hits;
}
