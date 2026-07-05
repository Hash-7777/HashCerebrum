// Cross-encoder rerank pass. After the hybrid ranker has ordered the candidates,
// this refines the order of the HEAD of the list by scoring each (query, passage)
// pair with the bundled cross-encoder — the joint reading a bi-encoder cosine
// cannot do. It is a pure add-on:
//   • only the top-N hits are rescored; the tail keeps its order;
//   • if the reranker model is not available (not vendored / failed to load) or
//     errors, the input order is returned unchanged.
// So this can never make retrieval worse than the existing ranking.

import type { RagSearchHit } from '../types';
import { RERANK_TOP_N } from '../rerank.config';
import { getRerankProvider, type RerankProvider } from '../rerank/workerClient';

// The text handed to the reranker for a hit: title + body, capped so the pair
// stays within the model's context.
const PASSAGE_CHARS = 2000;
function passageText(hit: RagSearchHit): string {
  const c = hit.chunk;
  return [c.title, c.text].filter(Boolean).join('. ').slice(0, PASSAGE_CHARS);
}

export interface CrossEncoderRerankOptions {
  /** Injectable provider (defaults to the process-wide worker client). */
  provider?: RerankProvider;
  /** How many leading hits to rescore (defaults to RERANK_TOP_N). */
  topN?: number;
}

export async function crossEncoderRerank(
  query: string,
  hits: RagSearchHit[],
  opts: CrossEncoderRerankOptions = {},
): Promise<RagSearchHit[]> {
  const provider = opts.provider ?? getRerankProvider();
  const topN = opts.topN ?? RERANK_TOP_N;
  if (hits.length < 2 || !query.trim()) return hits;

  const head = hits.slice(0, topN);
  const tail = hits.slice(topN);

  let scores: number[];
  try {
    scores = await provider.rerank(query, head.map(passageText));
  } catch {
    return hits; // fail safe — keep the incoming order
  }
  // Not ready, or a length mismatch → keep the incoming order untouched.
  if (scores.length !== head.length) return hits;

  const reordered = head
    .map((hit, i) => ({ hit, score: scores[i] ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.hit);

  return [...reordered, ...tail];
}
