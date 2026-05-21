// Memory graph — derives a relatedness diagram from a project's saved RAG
// chunks so Memory mode can render an Obsidian-style node graph.
//
// Pure, offline, lexical: an edge between two chunks is their shared-term
// overlap (Jaccard similarity) over the exact tokenizer the rag_search
// retriever uses. No embeddings, no network — relatedness is the same
// "meaningful term" model the rest of the app already trusts.

import { tokenize, type RagChunk } from '@core/store/ragStore';

// Cap the node count so the O(n^2) pairwise pass and the force layout stay
// snappy. A project realistically holds tens of chunks; if it holds more,
// the newest ones are the most relevant to show.
export const MAX_GRAPH_NODES = 240;

// An edge is kept only above this Jaccard score — below it the two chunks
// share too little to be a meaningful link, and drawing it just adds noise.
const MIN_SIMILARITY = 0.08;

// Each node keeps at most this many edges (its strongest links). Without a
// cap, dense clusters collapse into an unreadable hairball.
const MAX_EDGES_PER_NODE = 6;

export interface MemoryGraphNode {
  id: string;
  chunk: RagChunk;
  label: string;
  degree: number; // edge count — drives the rendered node radius
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
  weight: number; // 0..1 relatedness
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
}

/** Jaccard similarity of two token sets: |A∩B| / |A∪B|. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const term of small) if (large.has(term)) intersection += 1;
  if (intersection === 0) return 0;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Build the relatedness graph for a set of project chunks. Every chunk
 * becomes a node; edges are the strongest lexical links between them,
 * capped per node so the diagram stays legible. Isolated chunks (no link
 * above the threshold) are still returned as zero-degree nodes.
 */
export function buildMemoryGraph(chunks: RagChunk[]): MemoryGraph {
  const ordered = [...chunks]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_GRAPH_NODES);

  const tokenSets = ordered.map(
    (chunk) => new Set([...tokenize(chunk.title), ...tokenize(chunk.text)]),
  );

  // All candidate edges above the floor, strongest first.
  const candidates: MemoryGraphEdge[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const weight = jaccard(tokenSets[i]!, tokenSets[j]!);
      if (weight >= MIN_SIMILARITY) {
        candidates.push({ source: ordered[i]!.id, target: ordered[j]!.id, weight });
      }
    }
  }
  candidates.sort((a, b) => b.weight - a.weight);

  // Greedily keep edges, strongest first, while neither endpoint is full.
  const degree = new Map<string, number>();
  const edges: MemoryGraphEdge[] = [];
  for (const edge of candidates) {
    const sourceDegree = degree.get(edge.source) ?? 0;
    const targetDegree = degree.get(edge.target) ?? 0;
    if (sourceDegree >= MAX_EDGES_PER_NODE || targetDegree >= MAX_EDGES_PER_NODE) continue;
    edges.push(edge);
    degree.set(edge.source, sourceDegree + 1);
    degree.set(edge.target, targetDegree + 1);
  }

  const nodes: MemoryGraphNode[] = ordered.map((chunk) => ({
    id: chunk.id,
    chunk,
    label: chunk.title.trim() || 'Untitled',
    degree: degree.get(chunk.id) ?? 0,
  }));

  return { nodes, edges };
}
