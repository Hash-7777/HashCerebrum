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
import { buildRagIndex, searchRagIndex, lexicalSearch, tokenize, type RagIndex } from './ragSearch';

export { lexicalSearch, tokenize };

const STORAGE_KEY = 'rag.v1';
const MAX_CHUNKS = 1000;
const DEFAULT_SEARCH_LIMIT = 8;

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
  // Remove this project's chunks for which `keep` returns false; returns the
  // number removed. Used by the "prune" cleanup to drop non-medical / off-topic
  // findings without touching the good ones.
  pruneProject: (projectId: string, keep: (chunk: RagChunk) => boolean) => number;
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
    .catch((err: unknown) => {
      console.error('[ragStore] persist failed:', err);
    });
}

let indexCache:
  | {
      chunksRef: RagChunk[];
      byProject: Map<string, RagIndex>;
    }
  | null = null;

function searchProjectIndex(chunks: RagChunk[], projectId: string, query: string, limit: number): RagSearchHit[] {
  if (!indexCache || indexCache.chunksRef !== chunks) {
    indexCache = { chunksRef: chunks, byProject: new Map() };
  }
  let index = indexCache.byProject.get(projectId);
  if (!index) {
    index = buildRagIndex(chunks.filter((chunk) => chunk.projectId === projectId));
    indexCache.byProject.set(projectId, index);
  }
  return searchRagIndex(index, query, limit);
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
    searchProjectIndex(get().chunks, projectId, query, limit),

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

  pruneProject: (projectId, keep) => {
    const before = get().chunks;
    const chunks = before.filter((c) => c.projectId !== projectId || keep(c));
    const removed = before.length - chunks.length;
    if (removed > 0) {
      persist(chunks);
      set({ chunks });
    }
    return removed;
  },
}));
