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
import type { BeliefState } from './types';
import { useRagStore } from '../store/ragStore';
import { planQuery, type QueryPlan } from './queryPlanner';
import { updateBeliefs } from './beliefState';
import { graphFromChunk, mergeGraph } from './knowledgeGraph';
import { updateReliabilityMap } from './sourceReliability';
import { enqueueGap } from './learningQueue';
import { useLearningStore } from './learningStore';
import { applyLearnedPriors } from './learnedPriors';
import { recallPriorBeliefs } from './priorRecall';
import { buildBuckets, buildConsensusSummary } from './consensusTimeline';
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
  /** True when a gap-filling re-retrieval round was triggered for this query. */
  reRetrieved: boolean;
  /** What the agent already believes about the touched chunks (or null). */
  priorMemoryNote: string | null;
  /** How the evidence consensus on this topic shifted over time (or null). */
  consensusNote: string | null;
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
// How many missing concepts get their own gap-filling search in the single
// re-retrieval round. Keeps the extra latency/token cost bounded.
const MAX_GAP_QUERIES = 2;

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

  // Close the learning loop: re-weight the candidates by what prior runs have
  // learned (source reliability, corroborated beliefs, knowledge-graph
  // centrality) before truncating to the final set. A cold store is a no-op.
  const learned = useLearningStore.getState();
  const learnedState = {
    beliefs: learned.beliefs,
    sourceReliability: learned.sourceReliability,
    graphNodes: learned.graphNodes,
  };
  const rankPools = (): RagSearchHit[] => {
    const merged = applyLearnedPriors(scoreHits(mergeHits(pools), plan), learnedState);
    return merged.slice(0, limit);
  };

  let hits = rankPools();

  // 3. Coverage assessment
  let chunks = hits.map((h) => h.chunk);
  let coverage = assessCoverage(query, chunks);
  let reRetrieved = false;

  // 3b. Gap-filling round — make retrieval actually agentic. When coverage is
  // poor, fire ONE more bounded round of searches aimed squarely at the missing
  // concepts, fold the results into the candidate pool, and re-rank. Single
  // extra round keeps the token/latency budget fixed; deterministic, so it runs
  // the same on Ollama as on cloud models.
  if (coverage.needsReRetrieve && coverage.missingConcepts.length > 0) {
    const gapQueries = coverage.missingConcepts
      .slice(0, MAX_GAP_QUERIES)
      .map((concept) => `${concept} ${query}`);
    const gapResults = await Promise.allSettled(
      gapQueries.map((gq) => doRetrieve(gq, retrieveLimit, tag)),
    );
    let widened = false;
    for (const r of gapResults) {
      if (r.status === 'fulfilled' && r.value.length > 0) {
        pools.push(r.value);
        widened = true;
      }
    }
    if (widened) {
      reRetrieved = true;
      hits = rankPools();
      chunks = hits.map((h) => h.chunk);
      coverage = assessCoverage(query, chunks);
    }
  }

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
  if (reRetrieved) {
    parts.push('Ran a gap-filling re-retrieval round for under-covered concepts.');
  }
  // Recall what the agent already believes about the chunks in this set, so the
  // answering model can corroborate or challenge prior conclusions.
  const priorMemoryNote = recallPriorBeliefs(
    chunks.map((c) => c.id),
    learned.beliefs,
  );
  if (priorMemoryNote) parts.push(priorMemoryNote);

  // Consensus over time — bucket the beliefs this set touches by publication
  // year and report how the dominant direction shifted. A genuine edge: a
  // stateless retriever cannot tell the model "consensus flipped in 2019".
  const consensusNote = buildConsensusNote(chunks, learned.beliefs);
  if (consensusNote) parts.push(consensusNote);

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
    reRetrieved,
    priorMemoryNote,
    consensusNote,
  };
}

/**
 * Build a consensus-over-time note from the beliefs the retrieved chunks touch,
 * dated by each chunk's publication year. Returns null unless at least two
 * distinct years are represented (a single year is not a trend).
 */
function buildConsensusNote(chunks: RagChunk[], beliefs: BeliefState[]): string | null {
  const years: Record<string, number> = {};
  for (const c of chunks) {
    const y = typeof c.year === 'string' ? Number.parseInt(c.year, 10) : c.year;
    if (y && Number.isFinite(y)) years[c.id] = y;
  }
  if (Object.keys(years).length === 0) return null;
  const buckets = buildBuckets(beliefs, years);
  if (buckets.length < 2) return null;
  return buildConsensusSummary(buckets);
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
