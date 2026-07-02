// Hybrid retrieval: blends the lexical TF-IDF ranking with semantic cosine
// ranking via Reciprocal Rank Fusion, then weights by project so the active
// project ranks first in a cross-project search. Pure (takes its inputs, does
// no I/O) so it can be unit-tested with hand-built vectors.

import type { RagChunk, RagSearchHit } from '../types';
import { cosineSim } from './cosine';
import { fuseAndWeight } from './fusion';
import { lexicalSearch } from './lexical';
import { medicalBoost, mmrRerank } from './ranking';

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
  /** Apply MMR diversity re-ranking over the top candidates (default false). */
  diversify?: boolean;
  /** MMR relevance/novelty balance in [0,1] (default 0.7). */
  mmrLambda?: number;
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

  // Fuse, then nudge by clinical signal (evidence strength + recency). The boost
  // is a no-op for chunks without that metadata, so ranking is unchanged there.
  const ranked: RagSearchHit[] = [];
  for (const fused of fuseAndWeight(rankedLists, weightOf)) {
    const chunk = byId.get(fused.id);
    if (!chunk) continue;
    ranked.push({ chunk, score: fused.score * medicalBoost(chunk) });
  }
  ranked.sort((a, b) => b.score - a.score);

  // Optional MMR diversity, else just take the top.
  //
  // MMR is O(picks² · dim), so applying it to a large limit (the Memory UI asks
  // for up to 200 results) means billions of cosine ops on the main thread — it
  // froze the app on every keystroke. Diversify only a bounded HEAD of the
  // ranking and append the remainder by relevance. For the small limits used by
  // research retrieval (≤ the cap) this is identical to diversifying the whole
  // result, so retrieval behaviour is unchanged; only the large browse limit is
  // spared the quadratic blow-up.
  if (input.diversify) {
    const DIVERSIFY_CAP = 24;
    const picks = Math.min(limit, DIVERSIFY_CAP);
    const window = ranked.slice(0, Math.max(picks * 3, picks));
    const head = mmrRerank(window, vectorFor, input.mmrLambda ?? 0.7, picks);
    if (limit <= DIVERSIFY_CAP) return head;
    const headIds = new Set(head.map((h) => h.chunk.id));
    const tail = ranked.filter((h) => !headIds.has(h.chunk.id));
    return [...head, ...tail].slice(0, limit);
  }
  return ranked.slice(0, limit);
}
