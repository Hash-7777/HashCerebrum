/**
 * Shared types for the agentic learning layer — belief states, consensus
 * timelines, knowledge graphs, episodic memory, source reliability, and
 * the active-learning queue. Kept dependency-free for testability.
 */

// ── Belief State ────────────────────────────────────────────────────────────

export interface BeliefState {
  id: string;
  /** Normalised claim text (stemmed, lowercased) for deduplication. */
  claimFingerprint: string;
  /** Best representative text of this belief. */
  representativeText: string;
  /** 0–1 aggregate confidence across all supporting evidence. */
  beliefScore: number;
  /** Chunk IDs that support this claim. */
  supportingChunks: string[];
  /** Chunk IDs that contradict this claim. */
  conflictingChunks: string[];
  /** How many times this belief has been reinforced or revised. */
  revisionCount: number;
  /** When this belief was first observed. */
  firstSeenAt: string;
  /** When this belief was last updated. */
  lastUpdatedAt: string;
  /** Optional structured fields (effect size, p-value, etc.). */
  structured?: {
    effectLabel?: string;
    effectValue?: string;
    pValue?: string;
    ci?: string;
    sampleSize?: number;
  };
}

// ── Consensus Timeline ──────────────────────────────────────────────────────

export interface ConsensusEntry {
  periodStart: number; // year
  periodEnd: number;   // year
  /** 'positive' | 'negative' | 'neutral' | 'mixed' | 'unknown' */
  dominantDirection: string;
  /** How confident the aggregation is (0–1). */
  confidence: number;
  /** Key chunk IDs that define this period. */
  keyChunks: string[];
  /** Human-readable summary of the period. */
  summary: string;
}

export interface ConsensusTimeline {
  id: string;
  /** Normalised topic key, e.g. "aspirin:primary_prevention". */
  topicKey: string;
  /** Human-readable label. */
  label: string;
  entries: ConsensusEntry[];
  lastUpdatedAt: string;
}

// ── Knowledge Graph ─────────────────────────────────────────────────────────

export type GraphNodeType = 'drug' | 'condition' | 'outcome' | 'biomarker' | 'population' | 'intervention' | 'gene' | 'unknown';

export interface KnowledgeGraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  /** Alternative names (brand/generic, abbreviations). */
  aliases: string[];
  /** 0–1 confidence that this entity exists. */
  confidence: number;
  /** Chunk IDs that mention this entity. */
  supportingChunks: string[];
  firstSeenAt: string;
  lastUpdatedAt: string;
}

export type GraphEdgeRelation =
  | 'treats'
  | 'causes'
  | 'associated_with'
  | 'contraindicated_in'
  | 'prevents'
  | 'worsens'
  | 'has_biomarker'
  | 'affects'
  | 'interacts_with'
  | 'unknown';

export interface KnowledgeGraphEdge {
  id: string;
  source: string; // node id
  target: string; // node id
  relation: GraphEdgeRelation;
  /** 0–1 confidence in this relation. */
  confidence: number;
  /** Chunk IDs that assert this relation. */
  supportingChunks: string[];
  firstSeenAt: string;
  lastUpdatedAt: string;
}

// ── Source Reliability ──────────────────────────────────────────────────────

export interface SourceReliability {
  /** Journal name, author name, or source identifier. */
  source: string;
  /** 0–1 reliability score. */
  score: number;
  /** How many times this source has been cited. */
  citationCount: number;
  /** Number of retractions detected. */
  retractionCount: number;
  /** Average evidence strength of papers from this source. */
  avgEvidenceStrength: number;
  /** Last time this score was updated. */
  lastUpdatedAt: string;
}

// ── Episodic Memory ─────────────────────────────────────────────────────────

export interface ResearchEpisode {
  id: string;
  projectId: string;
  /** The original user question. */
  query: string;
  /** Sub-queries that were researched. */
  subQueries: string[];
  /** Number of evidence items found. */
  evidenceCount: number;
  /** Concepts that were NOT covered. */
  gaps: string[];
  /** Overall confidence in the answer (0–1). */
  confidence: number;
  /** Which model actually answered. */
  modelUsed: string;
  /** Key chunk IDs cited. */
  citedChunks: string[];
  /** Whether the answer was accepted, rejected, or revised. */
  outcome: 'accepted' | 'rejected' | 'revised' | 'unknown';
  createdAt: string;
}

// ── Active Learning Queue ───────────────────────────────────────────────────

export type LearningQueueStatus = 'pending' | 'scheduled' | 'done' | 'stale';

export interface LearningQueueItem {
  id: string;
  projectId: string;
  /** The missing concept or gap. */
  concept: string;
  /** Search query to fill this gap. */
  query: string;
  /** 0–1 priority (higher = more important). */
  priority: number;
  status: LearningQueueStatus;
  /** When this gap was discovered. */
  discoveredAt: string;
  /** When the gap was filled (or null). */
  resolvedAt: string | null;
  /** Chunk IDs that partially covered this concept. */
  partialEvidence: string[];
}

// ── Semantic Drift ──────────────────────────────────────────────────────────

export interface SemanticDriftRecord {
  id: string;
  /** The term or concept being tracked. */
  term: string;
  /** Year → embedding snapshot (cosine vs baseline). */
  snapshots: { year: number; driftScore: number; sampleCount: number }[];
  /** Alert if drift exceeds this threshold. */
  alertThreshold: number;
  lastUpdatedAt: string;
}
