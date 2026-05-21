// Memory graph — derives a topic-related diagram from a project's saved RAG
// chunks so Memory mode can render an Obsidian-style graph.
//
// Phase 35 deliberately avoids raw Jaccard edges. Links are now grounded in
// rarity-weighted terms, topic phrases, run/query grouping, and medical-ish
// entity terms, so a generic word like "study" cannot create a false link.

import { tokenize, type RagChunk } from '@core/store/ragStore';

// Cap the node count so the pairwise pass and force layout stay snappy.
// A project realistically holds tens of chunks; if it holds more, the newest
// ones are the most relevant to show.
export const MAX_GRAPH_NODES = 240;

const MIN_RELATEDNESS = 0.2;
const MAX_EDGES_PER_NODE = 6;
const MAX_CLUSTER_TERMS = 6;

// Domain-generic words are allowed in the retriever, but they should not be
// graph anchors. They are too common in manuscript answers and abstracts.
const GRAPH_GENERIC_TERMS = new Set([
  'abstract',
  'analysis',
  'answer',
  'article',
  'background',
  'clinical',
  'conclusion',
  'conclusions',
  'data',
  'design',
  'discussion',
  'evidence',
  'finding',
  'findings',
  'health',
  'introduction',
  'journal',
  'limitation',
  'limitations',
  'manuscript',
  'method',
  'methods',
  'objective',
  'outcome',
  'outcomes',
  'paper',
  'patient',
  'patients',
  'publication',
  'record',
  'records',
  'research',
  'result',
  'results',
  'review',
  'source',
  'sources',
  'study',
  'studies',
  'summary',
  'synthesis',
  'systematic',
  'therapy',
  'treatment',
  'trial',
  'trials',
]);

const MEDICAL_ENTITY_HINT = /(?:ase|itis|osis|emia|oma|pathy|plasty|ectomy|otomy|azole|cillin|cycline|floxacin|mycin|pril|sartan|statin|mab|nib|vir|xaban)$/;

export interface MemoryGraphNode {
  id: string;
  chunk: RagChunk;
  label: string;
  degree: number; // edge count — drives the rendered node radius
  clusterId: string;
  topicTerms: string[];
}

export type MemoryGraphEdgeReason = 'same_run' | 'same_topic' | 'shared_entities' | 'semantic_overlap';

export interface MemoryGraphEdge {
  source: string;
  target: string;
  weight: number; // 0..1 relatedness
  reason: MemoryGraphEdgeReason;
  label: string;
}

export interface MemoryGraphCluster {
  id: string;
  label: string;
  nodeIds: string[];
  terms: string[];
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  clusters: MemoryGraphCluster[];
}

interface ChunkProfile {
  chunk: RagChunk;
  index: number;
  terms: Map<string, number>;
  phrases: Set<string>;
  entityTerms: Set<string>;
  queryTerms: Set<string>;
  topicKey: string;
  clusterId: string;
}

function graphTokens(value: string | undefined): string[] {
  return tokenize(value ?? '').filter((term) => !GRAPH_GENERIC_TERMS.has(term));
}

function addWeightedTerms(map: Map<string, number>, terms: string[], weight: number) {
  for (const term of terms) map.set(term, (map.get(term) ?? 0) + weight);
}

function phrasesFrom(tokens: string[], maxPhrases: number): string[] {
  const phrases: string[] = [];
  for (const size of [3, 2]) {
    for (let i = 0; i <= tokens.length - size; i += 1) {
      const slice = tokens.slice(i, i + size);
      if (slice.some((term) => GRAPH_GENERIC_TERMS.has(term))) continue;
      phrases.push(slice.join(' '));
      if (phrases.length >= maxPhrases) return phrases;
    }
  }
  return phrases;
}

function topicKeyFrom(chunk: RagChunk): string {
  if (chunk.runId) return `run:${chunk.runId}`;
  const queryTerms = graphTokens(chunk.query).slice(0, 8).sort();
  if (queryTerms.length >= 2) return `query:${queryTerms.join('|')}`;
  const titleTerms = graphTokens(chunk.title).slice(0, 5).sort();
  return titleTerms.length > 0 ? `topic:${titleTerms.join('|')}` : `chunk:${chunk.id}`;
}

function cleanTopicLabel(value: string | undefined, fallback: string): string {
  const stripped = (value ?? '')
    .replace(/\b(make|write|draft|create|produce)\b/gi, ' ')
    .replace(/\b(a|an|the|full|complete|publishable|publication[-\s]?style)\b/gi, ' ')
    .replace(/\b(research\s+paper|paper|manuscript|journal\s+article|article)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || fallback;
}

function buildProfiles(chunks: RagChunk[]): ChunkProfile[] {
  return chunks.map((chunk, index) => {
    const queryTokens = graphTokens(chunk.query);
    const titleTokens = graphTokens(chunk.title);
    const bodyTokens = graphTokens(chunk.text);
    const terms = new Map<string, number>();

    addWeightedTerms(terms, queryTokens, 3.2);
    addWeightedTerms(terms, titleTokens, 2.4);
    addWeightedTerms(terms, bodyTokens, 1);

    const phraseValues = [
      ...phrasesFrom(queryTokens, 10),
      ...phrasesFrom(titleTokens, 10),
      ...phrasesFrom(bodyTokens, 18),
    ];
    for (const phrase of phraseValues) terms.set(phrase, (terms.get(phrase) ?? 0) + 2.1);

    const topicKey = topicKeyFrom(chunk);

    return {
      chunk,
      index,
      terms,
      phrases: new Set(phraseValues),
      entityTerms: new Set(),
      queryTerms: new Set(queryTokens),
      topicKey,
      clusterId: topicKey,
    };
  });
}

function documentFrequency(profiles: ChunkProfile[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const profile of profiles) {
    for (const term of profile.terms.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return df;
}

function idfFor(totalDocs: number, df: Map<string, number>, term: string): number {
  return 1 + Math.log((totalDocs + 1) / ((df.get(term) ?? 0) + 0.5));
}

function finalizeEntityTerms(profiles: ChunkProfile[], df: Map<string, number>) {
  const totalDocs = Math.max(profiles.length, 1);
  for (const profile of profiles) {
    for (const term of profile.terms.keys()) {
      const words = term.split(' ');
      const idf = idfFor(totalDocs, df, term);
      const isPhrase = words.length > 1;
      const inQuery = words.length === 1 && profile.queryTerms.has(term);
      const looksMedical = words.some((word) => MEDICAL_ENTITY_HINT.test(word));
      if (isPhrase || inQuery || looksMedical || (term.length >= 5 && idf >= 1.35)) {
        profile.entityTerms.add(term);
      }
    }
  }
}

function weightedCosine(a: Map<string, number>, b: Map<string, number>, df: Map<string, number>, totalDocs: number): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (const [term, value] of a) {
    const weight = value * idfFor(totalDocs, df, term);
    aNorm += weight * weight;
    const other = b.get(term);
    if (other !== undefined) dot += weight * other * idfFor(totalDocs, df, term);
  }
  for (const [term, value] of b) {
    const weight = value * idfFor(totalDocs, df, term);
    bNorm += weight * weight;
  }
  if (dot === 0 || aNorm === 0 || bNorm === 0) return 0;
  return dot / Math.sqrt(aNorm * bNorm);
}

function weightedJaccard(a: Set<string>, b: Set<string>, df: Map<string, number>, totalDocs: number): number {
  if (a.size === 0 || b.size === 0) return 0;
  const union = new Set([...a, ...b]);
  let intersectionWeight = 0;
  let unionWeight = 0;
  for (const term of union) {
    const weight = idfFor(totalDocs, df, term);
    unionWeight += weight;
    if (a.has(term) && b.has(term)) intersectionWeight += weight;
  }
  return unionWeight === 0 ? 0 : intersectionWeight / unionWeight;
}

function sharedTerms(a: Set<string>, b: Set<string>, df: Map<string, number>, totalDocs: number): string[] {
  return [...a]
    .filter((term) => b.has(term))
    .sort((left, right) => idfFor(totalDocs, df, right) - idfFor(totalDocs, df, left))
    .slice(0, 3);
}

function edgeFor(a: ChunkProfile, b: ChunkProfile, df: Map<string, number>, totalDocs: number): MemoryGraphEdge | null {
  const sameRun = !!a.chunk.runId && a.chunk.runId === b.chunk.runId;
  const sameTopic = a.topicKey === b.topicKey && !a.topicKey.startsWith('chunk:');
  const entityScore = weightedJaccard(a.entityTerms, b.entityTerms, df, totalDocs);
  const phraseScore = weightedJaccard(a.phrases, b.phrases, df, totalDocs);
  const vectorScore = weightedCosine(a.terms, b.terms, df, totalDocs);
  const shared = sharedTerms(a.entityTerms, b.entityTerms, df, totalDocs);

  if (!sameRun && !sameTopic && shared.length === 0 && phraseScore < 0.18) return null;

  const groupScore = sameRun ? 0.52 : sameTopic ? 0.38 : 0;
  const score = Math.min(
    1,
    groupScore + entityScore * 0.46 + phraseScore * 0.28 + vectorScore * 0.2,
  );
  if (score < MIN_RELATEDNESS) return null;

  const reason: MemoryGraphEdgeReason = sameRun
    ? 'same_run'
    : sameTopic
      ? 'same_topic'
      : shared.length > 0
        ? 'shared_entities'
        : 'semantic_overlap';
  const label =
    reason === 'same_run'
      ? 'same research run'
      : reason === 'same_topic'
        ? 'same research topic'
        : shared.length > 0
          ? shared.join(', ')
          : 'topic phrase overlap';

  return { source: a.chunk.id, target: b.chunk.id, weight: score, reason, label };
}

function topTermsForCluster(profiles: ChunkProfile[], df: Map<string, number>, totalDocs: number): string[] {
  const scores = new Map<string, number>();
  for (const profile of profiles) {
    for (const term of profile.entityTerms) {
      if (term.includes(' ') || profile.queryTerms.has(term) || idfFor(totalDocs, df, term) >= 1.35) {
        scores.set(term, (scores.get(term) ?? 0) + idfFor(totalDocs, df, term));
      }
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([term]) => term)
    .slice(0, MAX_CLUSTER_TERMS);
}

function buildClusters(profiles: ChunkProfile[], df: Map<string, number>, totalDocs: number): MemoryGraphCluster[] {
  const byCluster = new Map<string, ChunkProfile[]>();
  for (const profile of profiles) {
    const list = byCluster.get(profile.clusterId) ?? [];
    list.push(profile);
    byCluster.set(profile.clusterId, list);
  }

  return [...byCluster.entries()]
    .map(([id, list]) => {
      const terms = topTermsForCluster(list, df, totalDocs);
      const query = list.find((profile) => profile.chunk.query)?.chunk.query;
      const fallback = terms.length > 0 ? terms.slice(0, 3).join(' / ') : 'Untitled topic';
      return {
        id,
        label: cleanTopicLabel(query, fallback),
        nodeIds: list.map((profile) => profile.chunk.id),
        terms,
      };
    })
    .sort((a, b) => b.nodeIds.length - a.nodeIds.length || a.label.localeCompare(b.label));
}

/**
 * Build the relatedness graph for a set of project chunks. Every chunk
 * becomes a node; edges are the strongest semantic/topic links between them,
 * capped per node so the diagram stays legible. Isolated chunks are still
 * returned as zero-degree nodes.
 */
export function buildMemoryGraph(chunks: RagChunk[]): MemoryGraph {
  const ordered = [...chunks]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_GRAPH_NODES);

  const profiles = buildProfiles(ordered);
  const df = documentFrequency(profiles);
  const totalDocs = Math.max(profiles.length, 1);
  finalizeEntityTerms(profiles, df);

  // All candidate edges above the floor, strongest first.
  const candidates: MemoryGraphEdge[] = [];
  for (let i = 0; i < profiles.length; i += 1) {
    for (let j = i + 1; j < profiles.length; j += 1) {
      const edge = edgeFor(profiles[i]!, profiles[j]!, df, totalDocs);
      if (edge) candidates.push(edge);
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

  const clusters = buildClusters(profiles, df, totalDocs);
  const clusterOrder = new Map(clusters.map((cluster, index) => [cluster.id, index]));
  const nodes: MemoryGraphNode[] = profiles.map((profile) => ({
    id: profile.chunk.id,
    chunk: profile.chunk,
    label: profile.chunk.title.trim() || 'Untitled',
    degree: degree.get(profile.chunk.id) ?? 0,
    clusterId: profile.clusterId,
    topicTerms: topTermsForCluster([profile], df, totalDocs),
  }));

  nodes.sort(
    (a, b) =>
      (clusterOrder.get(a.clusterId) ?? 0) - (clusterOrder.get(b.clusterId) ?? 0) ||
      b.chunk.createdAt.localeCompare(a.chunk.createdAt),
  );

  return { nodes, edges, clusters };
}
