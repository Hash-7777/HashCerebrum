// SINGLE SOURCE OF TRUTH for the embedding model. Swapping the model later
// (e.g. a future clean-licensed medical model) is a change to this file only —
// the worker, search, and store layers read everything from here.

export interface EmbeddingModelConfig {
  /** transformers.js model id — resolved from the bundled local path. */
  id: string;
  /** Output vector dimension. */
  dimension: number;
  /** Max input tokens the model accepts (longer text is split into passages). */
  maxTokens: number;
}

// Default: a medical/clinical fine-tune of bge-small (Apache-2.0), converted to
// ONNX and vendored under public/models/embed/<id>/.
export const EMBED_MODEL: EmbeddingModelConfig = {
  id: 'medembed-small-v0.1',
  dimension: 384,
  maxTokens: 512,
};

// Fallback: the prebuilt bge-small ONNX (MIT) — same dimension, so it is a true
// drop-in if the default model fails to load.
export const EMBED_MODEL_FALLBACK: EmbeddingModelConfig = {
  id: 'bge-small-en-v1.5',
  dimension: 384,
  maxTokens: 512,
};

// Where the bundled model assets live, served from the app origin (CSP 'self').
// transformers.js is pinned to this path with allowRemoteModels=false so it can
// never reach huggingface.co — preserving the zero-egress privacy guarantee.
export const EMBED_LOCAL_PATH = '/models/embed/';

// Long text (synthesised answers) is split into passages of roughly this many
// characters before embedding, so the 512-token context is never exceeded and
// retrieval is passage-level.
export const PASSAGE_CHAR_BUDGET = 1200;
