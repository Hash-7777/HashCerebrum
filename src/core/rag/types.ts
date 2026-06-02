// Shared types for the RAG medical-memory module. Kept dependency-free (no
// React, no zustand, no platform) so every layer below — search math, fusion,
// persistence — can import these and stay pure and unit-testable.

export type RagChunkKind = 'evidence' | 'answer';

// Evidence-strength grade, when the pipeline can derive one. Used later by the
// Phase-2 medical-aware ranker; stored now so the data is there when we need it.
export type EvidenceStrength = 'strong' | 'moderate' | 'weak' | 'context';

export interface RagChunk {
  id: string;
  projectId: string;
  kind: RagChunkKind;
  title: string;
  text: string;
  /** EvidenceItem source for evidence chunks, 'answer' for answers. */
  source: string;
  url?: string;
  runId?: string;
  /** The research question / subject topic that produced this chunk. */
  query?: string;
  createdAt: string;

  // --- v2 medical metadata (all optional; absent on migrated v1 chunks) ---
  year?: number | string;
  pmid?: string;
  doi?: string;
  authors?: string[];
  evidenceStrength?: EvidenceStrength;

  // Domain tag. Findings saved by the Drug-Interactions mode are tagged
  // 'drug_interactions' so that mode retrieves ONLY its own trusted findings,
  // while the rest of the app can still read them. Absent on general findings.
  tag?: string;
}

// Caller-supplied fields — the store stamps id, projectId, and createdAt.
export type NewRagChunk = Omit<RagChunk, 'id' | 'projectId' | 'createdAt'>;

export interface RagSearchHit {
  chunk: RagChunk;
  score: number;
}
// Alias used by newer code; identical shape.
export type RagHit = RagSearchHit;

// A normalised (unit-length) embedding. Normalising at creation lets cosine
// similarity collapse to a plain dot product in the hot path.
export type EmbeddingVector = Float32Array;

// Swappable embedding backend. Phase 1 ships one implementation (an in-app
// Web Worker running transformers.js); a future cloud/optional impl can satisfy
// the same interface without touching the search or store layers.
export interface EmbeddingProvider {
  /** True once a model is loaded and embed() will return real vectors. */
  readonly ready: boolean;
  /** Begin loading the model. Safe to call repeatedly; resolves when ready. */
  warmup(): Promise<void>;
  /** Embed texts into normalised vectors, in input order. */
  embed(texts: string[]): Promise<EmbeddingVector[]>;
}
