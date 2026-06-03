// Public API for the RAG medical-memory module. Callers (the rag_search tool,
// the Memory UI) import from here only — never from internal files — so the
// module's internals can evolve without rippling out.

import { getEmbeddingProvider } from './embeddings/workerClient';
import { useRagStore } from './store/ragStore';
import type { RagSearchHit } from './types';

export type {
  RagChunk,
  NewRagChunk,
  RagSearchHit,
  RagHit,
  RagChunkKind,
  EvidenceStrength,
  EmbeddingVector,
  EmbeddingProvider,
} from './types';

export { useRagStore, getChunkVectors, type LibraryDocument } from './store/ragStore';
export { lexicalSearch, tokenize } from './search/lexical';
export { getEmbeddingProvider } from './embeddings/workerClient';
export { classifyEvidenceStrength } from './search/ranking';
export {
  chunkDocument,
  cleanPdfText,
  deriveDocMeta,
  hashBytes,
  textQuality,
  type DocChunk,
} from './ingest/pdfImport';

export interface RetrieveOptions {
  activeProjectId: string;
  limit?: number;
  /** Restrict the search to findings carrying this domain tag (e.g.
   *  'drug_interactions'). Omit to search the whole library. */
  tag?: string;
}

/** The one retrieval entry point: hybrid semantic+lexical search across all
 *  projects, weighted toward the active one. Falls back to lexical when the
 *  embedder is unavailable. */
export async function retrieve(query: string, opts: RetrieveOptions): Promise<RagSearchHit[]> {
  return useRagStore.getState().searchHybrid(opts.activeProjectId, query, opts.limit, opts.tag);
}

/** Begin loading the embedding model so the first real search is fast. Safe to
 *  call eagerly at app start; a no-op where Web Workers are unavailable. */
export function warmupEmbeddings(): void {
  void getEmbeddingProvider().warmup();
}
