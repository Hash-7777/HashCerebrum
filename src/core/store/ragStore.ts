// Per-project RAG memory — a lexical knowledge store. Every research run
// saves the evidence it retrieved and the answer it wrote into the active
// project's store; later research can query it before hitting external
// databases.
//
// Retrieval is pure client-side keyword overlap (HashCortX parity) — no
// embeddings, no embedding-API dependency, works offline. lexicalSearch is
// exported as a pure function so it can be unit tested and, later, swapped
// for a vector backend without touching the store shape.
//
// Persisted through the platform storage adapter: Tauri Store in the
// desktop shell, localStorage in browser dev.

import { create } from 'zustand';
import { platform } from '@platform/index';

const STORAGE_KEY = 'rag.v1';
const MAX_CHUNKS = 1000;
const DEFAULT_SEARCH_LIMIT = 8;

// Generic English function words only — never anything biomedically
// meaningful (keep "effect", "study", "dose", etc. as searchable terms).
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is',
  'are', 'was', 'were', 'be', 'been', 'by', 'at', 'as', 'it', 'its', 'this',
  'that', 'these', 'those', 'from', 'into', 'than', 'then', 'what', 'which',
  'who', 'whom', 'how', 'why', 'when', 'where', 'does', 'do', 'did', 'has',
  'have', 'had', 'can', 'could', 'would', 'should', 'will', 'about', 'any',
]);

export type RagChunkKind = 'evidence' | 'answer';

export interface RagChunk {
  id: string;
  projectId: string;
  kind: RagChunkKind;
  title: string;
  text: string;
  source: string; // EvidenceItem source for evidence chunks, 'answer' for answers
  url?: string;
  runId?: string;
  query?: string; // the research question that produced this chunk
  createdAt: string;
}

// Caller-supplied fields — the store stamps id, projectId, and createdAt.
export type NewRagChunk = Omit<RagChunk, 'id' | 'projectId' | 'createdAt'>;

export interface RagSearchHit {
  chunk: RagChunk;
  score: number;
}

interface PersistShape {
  chunks: RagChunk[];
}

interface RagStore {
  chunks: RagChunk[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addChunks: (projectId: string, chunks: NewRagChunk[]) => void;
  search: (projectId: string, query: string, limit?: number) => RagSearchHit[];
  chunksForProject: (projectId: string) => RagChunk[];
  removeChunk: (id: string) => void;
  clearProject: (projectId: string) => void;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term));
}

// Pure lexical retrieval: rank chunks by query-term overlap, weighting a
// title hit above a body hit. Exported so it is unit-testable and isolated
// from storage. Caller passes the already project-filtered chunk list.
export function lexicalSearch(chunks: RagChunk[], query: string, limit: number): RagSearchHit[] {
  const terms = Array.from(new Set(tokenize(query)));
  if (terms.length === 0 || limit <= 0) return [];

  const hits: RagSearchHit[] = [];
  for (const chunk of chunks) {
    const titleTerms = new Set(tokenize(chunk.title));
    const bodyTerms = new Set(tokenize(chunk.text));
    let score = 0;
    for (const term of terms) {
      if (titleTerms.has(term)) score += 2;
      else if (bodyTerms.has(term)) score += 1;
    }
    if (score > 0) hits.push({ chunk, score });
  }

  hits.sort((a, b) => b.score - a.score || b.chunk.createdAt.localeCompare(a.chunk.createdAt));
  return hits.slice(0, limit);
}

// Evidence chunks are deduped per project so the same paper saved by
// repeated runs does not pile up. Answer chunks are always kept — each run
// produces a distinct synthesized answer.
function evidenceKey(projectId: string, chunk: { url?: string; title: string }): string {
  return `${projectId}::${(chunk.url || chunk.title).trim().toLowerCase()}`;
}

const emptyShape = (): PersistShape => ({ chunks: [] });

function normalizeShape(shape: Partial<PersistShape> | null | undefined): PersistShape {
  return {
    chunks: Array.isArray(shape?.chunks)
      ? shape.chunks.filter(
          (c): c is RagChunk => !!c && typeof c.id === 'string' && typeof c.projectId === 'string',
        )
      : [],
  };
}

async function loadPersisted(): Promise<PersistShape> {
  try {
    return normalizeShape(await platform().storage.get<PersistShape>(STORAGE_KEY));
  } catch {
    return emptyShape();
  }
}

function persist(chunks: RagChunk[]) {
  void platform()
    .storage.set<PersistShape>(STORAGE_KEY, { chunks })
    .catch(() => undefined);
}

export const useRagStore = create<RagStore>((set, get) => ({
  chunks: [],
  hydrated: false,

  hydrate: async () => {
    const { chunks } = await loadPersisted();
    set({ chunks, hydrated: true });
  },

  addChunks: (projectId, inputs) => {
    if (!projectId || inputs.length === 0) return;
    set((state) => {
      const seenEvidence = new Set(
        state.chunks
          .filter((c) => c.kind === 'evidence')
          .map((c) => evidenceKey(c.projectId, c)),
      );
      const now = new Date().toISOString();
      const fresh: RagChunk[] = [];
      for (const input of inputs) {
        if (input.kind === 'evidence') {
          const key = evidenceKey(projectId, input);
          if (seenEvidence.has(key)) continue;
          seenEvidence.add(key);
        }
        fresh.push({ ...input, id: crypto.randomUUID(), projectId, createdAt: now });
      }
      if (fresh.length === 0) return state;
      const chunks = [...fresh, ...state.chunks].slice(0, MAX_CHUNKS);
      persist(chunks);
      return { ...state, chunks };
    });
  },

  search: (projectId, query, limit = DEFAULT_SEARCH_LIMIT) =>
    lexicalSearch(
      get().chunks.filter((c) => c.projectId === projectId),
      query,
      limit,
    ),

  chunksForProject: (projectId) => get().chunks.filter((c) => c.projectId === projectId),

  removeChunk: (id) =>
    set((state) => {
      const chunks = state.chunks.filter((c) => c.id !== id);
      if (chunks.length === state.chunks.length) return state;
      persist(chunks);
      return { ...state, chunks };
    }),

  clearProject: (projectId) =>
    set((state) => {
      const chunks = state.chunks.filter((c) => c.projectId !== projectId);
      if (chunks.length === state.chunks.length) return state;
      persist(chunks);
      return { ...state, chunks };
    }),
}));
