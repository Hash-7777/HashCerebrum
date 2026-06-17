/**
 * Retrieval evaluation metrics — pure, deterministic ranking-quality measures
 * so changes to retrieval/ranking can be *measured* on a labelled query set
 * rather than guessed. Used by the rerank tests and available for any offline
 * eval harness. Zero dependencies.
 */

/** Fraction of all relevant items that appear in the top-k of a ranking. */
export function recallAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  let found = 0;
  for (const id of ranked.slice(0, k)) if (relevant.has(id)) found += 1;
  return found / relevant.size;
}

/** Fraction of the top-k that is relevant. */
export function precisionAtK(ranked: string[], relevant: Set<string>, k: number): number {
  if (k <= 0) return 0;
  let found = 0;
  for (const id of ranked.slice(0, k)) if (relevant.has(id)) found += 1;
  return found / k;
}

/** 1/(rank of the first relevant item), or 0 if none are relevant. */
export function reciprocalRank(ranked: string[], relevant: Set<string>): number {
  for (let i = 0; i < ranked.length; i += 1) {
    if (relevant.has(ranked[i]!)) return 1 / (i + 1);
  }
  return 0;
}

export interface LabelledQuery {
  ranked: string[];
  relevant: Set<string>;
}

/** Mean reciprocal rank across a set of labelled queries. */
export function meanReciprocalRank(queries: LabelledQuery[]): number {
  if (queries.length === 0) return 0;
  const sum = queries.reduce((acc, q) => acc + reciprocalRank(q.ranked, q.relevant), 0);
  return sum / queries.length;
}

/** Normalised discounted cumulative gain at k (binary relevance). */
export function ndcgAtK(ranked: string[], relevant: Set<string>, k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i += 1) {
    if (relevant.has(ranked[i]!)) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(k, relevant.size); i += 1) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}
