// SINGLE SOURCE OF TRUTH for the cross-encoder reranker model. Like the embedding
// model (see model.config.ts), swapping the reranker later is a change to this
// file only — the worker and search layers read everything from here.
//
// A reranker is a small, inference-only cross-encoder: it reads the (question,
// passage) pair TOGETHER and outputs a single relevance score. That joint reading
// is far more precise than comparing two independently-made meaning vectors, so it
// is used as a cheap, offline second pass over the top retrieved passages.

export interface RerankModelConfig {
  /** transformers.js model id — resolved from the bundled local path. */
  id: string;
  /** Max input tokens the model accepts (query + passage; longer is truncated). */
  maxTokens: number;
}

// Default: the ms-marco MiniLM cross-encoder (Apache-2.0), converted to ONNX and
// vendored under public/models/rerank/<id>/. It outputs one relevance logit per
// (query, passage) pair — higher means more relevant.
export const RERANK_MODEL: RerankModelConfig = {
  id: 'ms-marco-MiniLM-L-6-v2',
  maxTokens: 512,
};

// Where the bundled reranker assets live, served from the app origin (CSP 'self').
// transformers.js is pinned to this path with allowRemoteModels=false so it can
// never reach huggingface.co — preserving the zero-egress privacy guarantee.
export const RERANK_LOCAL_PATH = '/models/rerank/';

// How many of the top hybrid-retrieval hits to hand the reranker. The reranker is
// heavier per pair than a cosine compare, so we only refine the head of the list;
// the rest keep their existing order. Small enough to stay well under a second.
export const RERANK_TOP_N = 40;
