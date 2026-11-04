// Shared types for the RAG medical-memory module. Kept dependency-free (no
// React, no zustand, no platform) so every layer below — search math, fusion,
// persistence — can import these and stay pure and unit-testable.

// 'document' = a passage of a user-imported PDF (the local library). Like
// 'answer' it is project-narrative content, but it carries docId/page so the UI
// can group and delete whole documents and the Brain can cite a specific paper.
export type RagChunkKind = 'evidence' | 'answer' | 'document';

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

  // Domain tag. Findings saved by a drug-interaction run are tagged
  // 'drug_interactions' so such runs retrieve ONLY their own trusted findings,
  // while the rest of the app can still read them. Absent on general findings.
  tag?: string;

  // --- v3 imported-document fields (present only on kind 'document') ---
  /** Stable per-file id (SHA-256 of the bytes) — groups a document's passages
   *  and dedupes re-imports. */
  docId?: string;
  /** 1-based page number when the extractor provides one (citation locality). */
  page?: number;
  /** Passage order within the document. */
  chunkIndex?: number;
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
  /** Embed texts into normalised vectors, in input order. `kind` selects the
   *  asymmetric-retrieval treatment: 'query' applies the model's query
   *  instruction, 'passage' (default) embeds bare. */
  embed(texts: string[], kind?: 'query' | 'passage'): Promise<EmbeddingVector[]>;
}
