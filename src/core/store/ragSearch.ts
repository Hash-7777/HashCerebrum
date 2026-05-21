// Indexed lexical retrieval for per-project RAG memory.
//
// This stays offline and deterministic, but it is no longer a plain scan of
// every chunk for every query. The store builds a per-project term index and
// searches postings lists, then expands around the strongest run/query topic
// neighbourhoods so retrieval returns related findings, not only exact term
// hits.

import type { RagChunk, RagSearchHit } from './ragStore';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is',
  'are', 'was', 'were', 'be', 'been', 'by', 'at', 'as', 'it', 'its', 'this',
  'that', 'these', 'those', 'from', 'into', 'than', 'then', 'what', 'which',
  'who', 'whom', 'how', 'why', 'when', 'where', 'does', 'do', 'did', 'has',
  'have', 'had', 'can', 'could', 'would', 'should', 'will', 'about', 'any',
]);

interface Posting {
  index: number;
  weight: number;
}

interface IndexedDoc {
  chunk: RagChunk;
  norm: number;
  runKey: string | null;
  queryKey: string | null;
}

export interface RagIndex {
  chunks: RagChunk[];
  postings: Map<string, Posting[]>;
  docs: IndexedDoc[];
  runGroups: Map<string, number[]>;
  queryGroups: Map<string, number[]>;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term));
}

function uniqueTerms(value: string | undefined): string[] {
  return Array.from(new Set(tokenize(value ?? '')));
}

function normalizedQueryKey(value: string | undefined): string | null {
  const terms = uniqueTerms(value)
    .filter((term) => !['make', 'write', 'draft', 'full', 'paper', 'manuscript', 'research'].includes(term))
    .slice(0, 10)
    .sort();
  return terms.length >= 2 ? terms.join('|') : null;
}

function addWeightedTerms(map: Map<string, number>, terms: string[], weight: number) {
  for (const term of terms) map.set(term, (map.get(term) ?? 0) + weight);
}

function idf(totalDocs: number, df: Map<string, number>, term: string): number {
  return 1 + Math.log((totalDocs + 1) / ((df.get(term) ?? 0) + 0.5));
}

function pushGroup(map: Map<string, number[]>, key: string | null, index: number) {
  if (!key) return;
  const group = map.get(key) ?? [];
  group.push(index);
  map.set(key, group);
}

export function buildRagIndex(chunks: RagChunk[]): RagIndex {
  const termCounts = chunks.map((chunk) => {
    const counts = new Map<string, number>();
    addWeightedTerms(counts, uniqueTerms(chunk.query), 3);
    addWeightedTerms(counts, uniqueTerms(chunk.title), 2.4);
    addWeightedTerms(counts, tokenize(chunk.text), 1);
    return counts;
  });

  const df = new Map<string, number>();
  for (const counts of termCounts) {
    for (const term of counts.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const totalDocs = Math.max(chunks.length, 1);
  const postings = new Map<string, Posting[]>();
  const docs: IndexedDoc[] = [];
  const runGroups = new Map<string, number[]>();
  const queryGroups = new Map<string, number[]>();

  chunks.forEach((chunk, index) => {
    const counts = termCounts[index]!;
    let norm = 0;
    for (const [term, count] of counts) {
      const weight = count * idf(totalDocs, df, term);
      norm += weight * weight;
      const list = postings.get(term) ?? [];
      list.push({ index, weight });
      postings.set(term, list);
    }

    const runKey = chunk.runId ? `run:${chunk.runId}` : null;
    const queryKey = normalizedQueryKey(chunk.query);
    docs.push({ chunk, norm: Math.max(Math.sqrt(norm), 1), runKey, queryKey });
    pushGroup(runGroups, runKey, index);
    pushGroup(queryGroups, queryKey, index);
  });

  return { chunks, postings, docs, runGroups, queryGroups };
}

function addTopicNeighbourhoodScores(index: RagIndex, scores: Map<number, number>) {
  const seeds = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  for (const [seedIndex, seedScore] of seeds) {
    const seed = index.docs[seedIndex];
    if (!seed) continue;
    const groups = [
      seed.runKey ? { members: index.runGroups.get(seed.runKey), factor: 0.18 } : null,
      seed.queryKey ? { members: index.queryGroups.get(seed.queryKey), factor: 0.12 } : null,
    ];
    for (const group of groups) {
      if (!group?.members || group.members.length <= 1) continue;
      for (const memberIndex of group.members) {
        if (memberIndex === seedIndex) continue;
        scores.set(memberIndex, (scores.get(memberIndex) ?? 0) + seedScore * group.factor);
      }
    }
  }
}

export function searchRagIndex(index: RagIndex, query: string, limit: number): RagSearchHit[] {
  const terms = uniqueTerms(query);
  if (terms.length === 0 || limit <= 0) return [];

  const scores = new Map<number, number>();
  const totalDocs = Math.max(index.docs.length, 1);
  for (const term of terms) {
    const queryWeight = idf(totalDocs, new Map([[term, index.postings.get(term)?.length ?? 0]]), term);
    for (const posting of index.postings.get(term) ?? []) {
      scores.set(posting.index, (scores.get(posting.index) ?? 0) + posting.weight * queryWeight);
    }
  }

  if (scores.size === 0) return [];
  addTopicNeighbourhoodScores(index, scores);

  return [...scores.entries()]
    .map(([indexValue, score]) => {
      const doc = index.docs[indexValue]!;
      return { chunk: doc.chunk, score: score / doc.norm };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.chunk.createdAt.localeCompare(a.chunk.createdAt))
    .slice(0, limit);
}

export function lexicalSearch(chunks: RagChunk[], query: string, limit: number): RagSearchHit[] {
  return searchRagIndex(buildRagIndex(chunks), query, limit);
}
