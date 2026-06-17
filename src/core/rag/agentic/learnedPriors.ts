/**
 * Learned Priors — re-weight freshly retrieved hits by what the agent has
 * already learned across previous runs. This is what closes the learning loop:
 * the belief states, knowledge graph, and source-reliability scores that every
 * run *writes* are finally *read back* to influence ranking.
 *
 * A chunk is nudged up when:
 *   - its source has earned a high learned reliability score,
 *   - it supports a high-confidence belief the agent already holds,
 *   - it grounds entities that are central to the accumulated knowledge graph.
 *
 * Gentle and multiplicative (≈ ±25% total), matching the medicalBoost
 * philosophy, so semantics still lead retrieval and a strong prior can re-order
 * near-ties without ever burying a clearly-relevant new result.
 *
 * Pure and dependency-free: it takes plain learned state in, never the store,
 * so it is fully unit-testable and the search layer stays I/O-free. Zero model
 * calls — identical behaviour on cloud models and Ollama.
 */

import type { RagChunk, RagSearchHit } from '../types';
import type { BeliefState, KnowledgeGraphNode, SourceReliability } from './types';

/** The slice of learned state that influences ranking. */
export interface LearnedState {
  beliefs: BeliefState[];
  sourceReliability: Record<string, SourceReliability>;
  graphNodes: KnowledgeGraphNode[];
}

// Per-factor multiplier bounds — each gentle on its own, clamped in aggregate.
const RELIABILITY_SPAN = 0.2; // 0.5 (neutral) → 1.0; 1.0 → 1.1; 0.0 → 0.9
const BELIEF_SPAN = 0.2; // max corroboration boost ≈ +0.09 (belief 0.95)
const GRAPH_PER_NODE = 0.01; // +1% per grounded entity …
const GRAPH_MAX_NODES = 5; // … capped at +5%
const PRIOR_MIN = 0.85;
const PRIOR_MAX = 1.25;

/** Highest supporting-belief score for each chunk id (0 when none support it). */
function supportByChunk(beliefs: BeliefState[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of beliefs) {
    for (const id of b.supportingChunks) {
      const prev = m.get(id) ?? 0;
      if (b.beliefScore > prev) m.set(id, b.beliefScore);
    }
  }
  return m;
}

/** Number of knowledge-graph nodes each chunk id helps ground. */
function centralityByChunk(nodes: KnowledgeGraphNode[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of nodes) {
    for (const id of n.supportingChunks) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}

/** A reusable scorer bound to one snapshot of learned state. */
export interface PriorScorer {
  boostFor: (chunk: RagChunk) => number;
}

export function makePriorScorer(state: LearnedState): PriorScorer {
  const support = supportByChunk(state.beliefs);
  const centrality = centralityByChunk(state.graphNodes);

  return {
    boostFor(chunk: RagChunk): number {
      // Learned source reliability (defaults to neutral 0.5 for unseen sources).
      const reliability = state.sourceReliability[chunk.source]?.score ?? 0.5;
      const reliabilityMult = 0.9 + RELIABILITY_SPAN * reliability;

      // Belief corroboration — only the *agreeing* side lifts a chunk; chunks
      // that merely contradict a belief are surfaced as conflicts elsewhere and
      // left neutral here, never silently demoted.
      const belief = support.get(chunk.id) ?? 0;
      const beliefMult = 1 + Math.max(0, belief - 0.5) * BELIEF_SPAN;

      // Knowledge-graph centrality — chunks grounding more known entities.
      const nodes = Math.min(centrality.get(chunk.id) ?? 0, GRAPH_MAX_NODES);
      const graphMult = 1 + nodes * GRAPH_PER_NODE;

      const combined = reliabilityMult * beliefMult * graphMult;
      return Math.max(PRIOR_MIN, Math.min(PRIOR_MAX, combined));
    },
  };
}

/**
 * Re-weight a ranked hit list by learned priors and re-sort. A no-op (returns a
 * shallow copy in the same order) when there is no learned state yet, so a cold
 * store behaves exactly like the classical retriever.
 */
export function applyLearnedPriors(hits: RagSearchHit[], state: LearnedState): RagSearchHit[] {
  if (hits.length === 0) return hits;
  if (state.beliefs.length === 0 && state.graphNodes.length === 0 && Object.keys(state.sourceReliability).length === 0) {
    return hits;
  }
  const scorer = makePriorScorer(state);
  return hits
    .map((hit) => ({ ...hit, score: hit.score * scorer.boostFor(hit.chunk) }))
    .sort((a, b) => b.score - a.score);
}
