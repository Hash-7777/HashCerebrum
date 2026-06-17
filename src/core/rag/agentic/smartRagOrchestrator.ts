/**
 * Smart RAG Orchestrator — wraps hybrid search with lightweight agentic reasoning.
 *
 * Pipeline (per query):
 *   1. Plan: decompose query into sub-queries + concepts (1 model call, fallback)
 *   2. Retrieve: run each sub-query through hybrid search, merge + dedupe
 *   3. Coverage: assess which concepts are covered vs missing
 *   4. Claims: extract structured claims from each chunk
 *   5. Conflicts: detect contradictions between claims from different chunks
 *   6. Citations: follow DOI/PMID references to enrich context
 *   7. Return: annotated hits + coverage note + conflict summary
 *
 * Token budget: ~600-750 tokens for planning; everything else deterministic.
 */

import type { RagChunk, RagSearchHit } from '../types';
import { useRagStore } from '../store/ragStore';
import { planQuery, type QueryPlan } from './queryPlanner';
import { updateBeliefs } from './beliefState';
import { graphFromChunk, mergeGraph } from './knowledgeGraph';
import { updateReliabilityMap } from './sourceReliability';
import { enqueueGap } from './learningQueue';
import { useLearningStore } from './learningStore';
import { applyLearnedPriors } from './learnedPriors';
import { assessCoverage, type CoverageAssessment } from './coverageAssessor';
import { extractClaims, type ExtractedClaim } from './claimExtractor';
import { detectConflicts, type ClaimConflict } from './conflictDetector';
import { traverseCitations, type TraversalResult } from './citationTraverser';

export interface SmartRetrieveResult {
  hits: RagSearchHit[];
  plan: QueryPlan;
  coverage: CoverageAssessment;
  claims: ExtractedClaim[];
  conflicts: ClaimConflict[];
  citations: TraversalResult;
  gapNote: string | null;
}

export interface SmartRetrieveOptions {
  activeProjectId: string;
  limit?: number;
  tag?: string;
  /** User's selected model for query planning. If omitted, deterministic fallback is used. */
  model?: string;
}

const SUBQUERY_LIMIT = 6;
const MAX_SUB_QUERIES = 3;

function dedupeHits(hits: RagSearchHit[]): RagSearchHit[] {
  const seen = new Set<string>();
  const out: RagSearchHit[] = [];
  for (const h of hits) {
    if (seen.has(h.chunk.id)) continue;
    seen.add(h.chunk.id);
    out.push(h);
  }
  return out;
}

function mergeHits(pools: RagSearchHit[][]): RagSearchHit[] {
  const all = pools.flat();
  // Sort by score descending, then dedupe keeping highest score
  all.sort((a, b) => b.score - a.score);
  return dedupeHits(all);
}

function scoreHits(hits: RagSearchHit[], plan: QueryPlan): RagSearchHit[] {
  const conceptSet = new Set(plan.concepts.map((c) => c.toLowerCase()));
  return hits.map((hit) => {
    let boost = 0;
    const text = `${hit.chunk.title} ${hit.chunk.text}`.toLowerCase();
    for (const concept of conceptSet) {
      if (text.includes(concept)) boost += 0.02;
    }
    // Boost chunks with statistics
    if (/\b(?:n\s*=\s*\d|p\s*[<=>]\s*0?\.\d|95%\s*CI|OR\s*\d|HR\s*\d|RR\s*\d|mean\s*[±+-]|SD\s*\d)\b/i.test(text)) {
      boost += 0.03;
    }
    return { ...hit, score: hit.score + boost };
  });
}

export async function smartRetrieve(
  query: string,
  opts: SmartRetrieveOptions,
): Promise<SmartRetrieveResult> {
  const { activeProjectId, limit = SUBQUERY_LIMIT, tag, model } = opts;

  // Inline retrieve to avoid circular dependency with ../index.ts
  async function doRetrieve(q: string, l: number, t?: string): Promise<RagSearchHit[]> {
    return useRagStore.getState().searchHybrid(activeProjectId, q, l, t);
  }

  // 1. Plan
  const plan = await planQuery(query, model);

  // 2. Retrieve — original query + each sub-query
  const retrieveLimit = Math.max(4, Math.floor(limit / (1 + Math.min(plan.subQueries.length, MAX_SUB_QUERIES))));
  const pools: RagSearchHit[][] = [];

  // Always search the original query
  try {
    const original = await doRetrieve(query, retrieveLimit, tag);
    pools.push(original);
  } catch {
    /* ignore */
  }

  // Search sub-queries in parallel
  const subQueries = plan.subQueries.slice(0, MAX_SUB_QUERIES).filter((sq) => sq !== query);
  if (subQueries.length > 0) {
    const subResults = await Promise.allSettled(
      subQueries.map((sq) => doRetrieve(sq, retrieveLimit, tag)),
    );
    for (const r of subResults) {
      if (r.status === 'fulfilled') pools.push(r.value);
    }
  }

  let hits = mergeHits(pools);
  hits = scoreHits(hits, plan);
  // Close the learning loop: re-weight the candidates by what prior runs have
  // learned (source reliability, corroborated beliefs, knowledge-graph
  // centrality) before truncating to the final set. A cold store is a no-op.
  const learned = useLearningStore.getState();
  hits = applyLearnedPriors(hits, {
    beliefs: learned.beliefs,
    sourceReliability: learned.sourceReliability,
    graphNodes: learned.graphNodes,
  });
  hits = hits.slice(0, limit);

  // 3. Coverage assessment
  const chunks = hits.map((h) => h.chunk);
  const coverage = assessCoverage(query, chunks);

  // 4. Claim extraction
  const claims = chunks.flatMap((chunk) => extractClaims(chunk));

  // 5. Conflict detection
  const conflicts = detectConflicts(claims);

  // 6. Citation traversal
  const citations = traverseCitations(chunks);

  // 7. Build gap note
  const parts: string[] = [];
  if (coverage.gapNote) parts.push(coverage.gapNote);
  if (conflicts.length > 0) {
    const direct = conflicts.filter((c) => c.severity === 'high').length;
    const medium = conflicts.filter((c) => c.severity === 'medium').length;
    parts.push(
      `Detected ${conflicts.length} potential claim conflict${conflicts.length === 1 ? '' : 's'}` +
        (direct > 0 ? ` (${direct} high-severity)` : '') +
        (medium > 0 ? ` (${medium} medium-severity)` : '') +
        `.`,
    );
  }
  if (citations.resolvedHits.length > 0) {
    parts.push(`Followed ${citations.resolvedHits.length} in-memory citation${citations.resolvedHits.length === 1 ? '' : 's'}.`);
  }

  const gapNote = parts.length > 0 ? parts.join(' ') : null;

  // 8. Update learning store (beliefs, graph, reliability, gaps)
  updateLearningState(activeProjectId, hits, claims, conflicts, coverage);

  return {
    hits,
    plan,
    coverage,
    claims,
    conflicts,
    citations,
    gapNote,
  };
}

function updateLearningState(
  projectId: string,
  hits: RagSearchHit[],
  claims: ExtractedClaim[],
  conflicts: ClaimConflict[],
  coverage: CoverageAssessment,
) {
  const learning = useLearningStore.getState();

  // Beliefs
  const updatedBeliefs = updateBeliefs(learning.beliefs, claims, conflicts);
  learning.setBeliefs(updatedBeliefs);

  // Knowledge graph
  let nodes = learning.graphNodes;
  let edges = learning.graphEdges;
  for (const { chunk } of hits) {
    const { nodes: newNodes, edges: newEdges } = graphFromChunk(chunk);
    const merged = mergeGraph(nodes, edges, newNodes, newEdges);
    nodes = merged.nodes;
    edges = merged.edges;
  }
  learning.setGraph(nodes, edges);

  // Source reliability
  let reliability = learning.sourceReliability;
  for (const { chunk } of hits) {
    reliability = updateReliabilityMap(reliability, chunk);
  }
  learning.setSourceReliability(reliability);

  // Learning queue (gaps)
  if (coverage.missingConcepts.length > 0) {
    let queue = learning.learningQueue;
    for (const concept of coverage.missingConcepts) {
      queue = enqueueGap(queue, projectId, concept, hits.map((h) => h.chunk.id));
    }
    learning.setLearningQueue(queue);
  }
}

/**
 * Synchronous smart-retrieve for the citationTraverser follow-up.
 * Uses the store's chunks directly (no hybrid search).
 */
export function smartRetrieveFromChunks(
  query: string,
  chunks: RagChunk[],
): Pick<SmartRetrieveResult, 'coverage' | 'claims' | 'conflicts' | 'citations' | 'gapNote'> {
  const coverage = assessCoverage(query, chunks);
  const claims = chunks.flatMap((chunk) => extractClaims(chunk));
  const conflicts = detectConflicts(claims);
  const citations = traverseCitations(chunks);

  const parts: string[] = [];
  if (coverage.gapNote) parts.push(coverage.gapNote);
  if (conflicts.length > 0) {
    parts.push(`Detected ${conflicts.length} potential claim conflict${conflicts.length === 1 ? '' : 's'}.`);
  }
  if (citations.resolvedHits.length > 0) {
    parts.push(`Followed ${citations.resolvedHits.length} in-memory citation${citations.resolvedHits.length === 1 ? '' : 's'}.`);
  }

  return {
    coverage,
    claims,
    conflicts,
    citations,
    gapNote: parts.length > 0 ? parts.join(' ') : null,
  };
}
