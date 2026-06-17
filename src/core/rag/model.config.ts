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
  /**
   * Asymmetric-retrieval query instruction. BGE-family models are trained to
   * embed the QUERY side with a short instruction prefix while passages are
   * embedded bare; supplying it lifts recall. Applied only to query text, never
   * to stored passages. Omit (or empty) to embed the query verbatim.
   */
  queryInstruction?: string;
}

// Default: a medical/clinical fine-tune of bge-small (Apache-2.0), converted to
// ONNX and vendored under public/models/embed/<id>/.
// queryInstruction is intentionally left unset: the published MedEmbed usage
// does not require the BGE prefix and its effect on this fine-tune has not been
// measured on a retrieval eval here, so we embed the query verbatim (no change
// to shipped behaviour). Set it once an eval confirms a gain.
export const EMBED_MODEL: EmbeddingModelConfig = {
  id: 'medembed-small-v0.1',
  dimension: 384,
  maxTokens: 512,
};

// Fallback: the prebuilt bge-small ONNX (MIT) — same dimension, so it is a true
// drop-in if the default model fails to load. bge-small-en-v1.5 IS trained with
// the query instruction below, so applying it here is the model-correct setup.
export const EMBED_MODEL_FALLBACK: EmbeddingModelConfig = {
  id: 'bge-small-en-v1.5',
  dimension: 384,
  maxTokens: 512,
  queryInstruction: 'Represent this sentence for searching relevant passages: ',
};

/** Prefix a query with the model's retrieval instruction, when it defines one. */
export function applyQueryInstruction(text: string, config: EmbeddingModelConfig): string {
  return config.queryInstruction ? `${config.queryInstruction}${text}` : text;
}

// Where the bundled model assets live, served from the app origin (CSP 'self').
// transformers.js is pinned to this path with allowRemoteModels=false so it can
// never reach huggingface.co — preserving the zero-egress privacy guarantee.
export const EMBED_LOCAL_PATH = '/models/embed/';

// Long text (synthesised answers) is split into passages of roughly this many
// characters before embedding, so the 512-token context is never exceeded and
// retrieval is passage-level.
export const PASSAGE_CHAR_BUDGET = 1200;
