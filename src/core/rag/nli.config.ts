// SINGLE SOURCE OF TRUTH for the natural-language-inference (NLI) model used to
// fact-check answers. Like the embedding + reranker models, swapping it later is a
// change to this file only.
//
// NLI = does the source (premise) actually SUPPORT the claim (hypothesis)? The
// model reads the pair together and scores entailment / neutral / contradiction.
// We use the entailment probability to flag answer sentences a cited source does
// not clearly back — an offline, model-checked guard against overreach.

export interface NliModelConfig {
  /** transformers.js model id — resolved from the bundled local path. */
  id: string;
  /** Max input tokens (premise + hypothesis; longer is truncated). */
  maxTokens: number;
}

// MobileBERT fine-tuned on MNLI (~27 MB int8) — small, wordpiece vocab, solid
// entailment accuracy. Its id2label is {0: ENTAILMENT, 1: NEUTRAL, 2:
// CONTRADICTION}; the worker reads the entailment index from the model config so
// a swap to a differently-ordered model needs no code change.
export const NLI_MODEL: NliModelConfig = {
  id: 'mobilebert-uncased-mnli',
  maxTokens: 512,
};

// Where the bundled NLI assets live, served from the app origin (CSP 'self').
// allowRemoteModels=false pins loading to this folder — zero-egress.
export const NLI_LOCAL_PATH = '/models/nli/';

// Entailment probability at or above which a claim counts as "supported". Below
// it, the sentence is flagged as not clearly supported by its cited source.
export const ENTAILMENT_THRESHOLD = 0.5;
