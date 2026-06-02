// Per-project RAG memory store (zustand). Thin persistence + chunk CRUD; all
// retrieval math lives in ../search and all model work behind the
// EmbeddingProvider interface, so this file stays small and focused.
//
// Vectors: kept in memory as the compact quantised form (matching what is
// persisted) plus a lazy float cache for cosine. New chunks are embedded in the
// background; on hydrate any chunk without a vector is backfilled. Everything
// degrades to lexical search when the embedder is unavailable.

import { create } from 'zustand';
import { platform } from '@platform/index';
import type { NewRagChunk, RagChunk, RagSearchHit } from '../types';
import { PASSAGE_CHAR_BUDGET } from '../model.config';
import { getEmbeddingProvider } from '../embeddings/workerClient';
import { buildRagIndex, searchRagIndex, type RagIndex } from '../search/lexical';
import { hybridSearch } from '../search/hybrid';
import { expandQuery } from '../search/normalize';
import {
  dedupeChunks,
  dequantize,
  globalChunkKey,
  mergeChunks,
  migrateV1ToV2,
  normalizeV2,
  quantize,
  type PersistShapeV2,
  type QuantizedVector,
} from './persistence';

const STORAGE_KEY_V2 = 'rag.v2';
const STORAGE_KEY_V1 = 'rag.v1';
const MAX_CHUNKS = 5000;
const DEFAULT_SEARCH_LIMIT = 8;
const BACKFILL_BATCH = 16;

export type { RagChunk, NewRagChunk, RagSearchHit } from '../types';

interface RagStore {
  chunks: RagChunk[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addChunks: (projectId: string, chunks: NewRagChunk[]) => void;
  /** Lexical-only search (synchronous) — fallback + UI instant paint. */
  search: (projectId: string, query: string, limit?: number) => RagSearchHit[];
  /** Hybrid semantic+lexical search across all projects, active-weighted.
   *  When `tag` is given, only findings carrying that domain tag are searched
   *  (the Drug-Interactions mode passes 'drug_interactions' to read only its
   *  own trusted findings). */
  searchHybrid: (activeProjectId: string, query: string, limit?: number, tag?: string) => Promise<RagSearchHit[]>;
  chunksForProject: (projectId: string) => RagChunk[];
  removeChunk: (id: string) => void;
  clearProject: (projectId: string) => void;
  pruneProject: (projectId: string, keep: (chunk: RagChunk) => boolean) => number;
}

// --- in-memory vector state (module-scoped; mirrors persistence) ---
const quantized = new Map<string, QuantizedVector>();
const floatCache = new Map<string, Float32Array>();

function vectorFor(id: string): Float32Array | undefined {
  const cached = floatCache.get(id);
  if (cached) return cached;
  const qv = quantized.get(id);
  if (!qv) return undefined;
  const vec = dequantize(qv);
  floatCache.set(id, vec);
  return vec;
}

/** Stored (dequantised) embeddings for the given chunk ids — only those that
 *  have been embedded. Used by the 3D vector map to plot real vector data. */
export function getChunkVectors(ids: string[]): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  for (const id of ids) {
    const vec = vectorFor(id);
    if (vec) out.set(id, vec);
  }
  return out;
}

function embedTextForChunk(chunk: { title: string; text: string }): string {
  return [chunk.title, chunk.text].filter(Boolean).join('. ').slice(0, PASSAGE_CHAR_BUDGET);
}

// --- persistence ---
async function loadPersisted(): Promise<PersistShapeV2> {
  try {
    const v2 = await platform().storage.get<PersistShapeV2>(STORAGE_KEY_V2);
    if (v2) return normalizeV2(v2);
    const v1 = await platform().storage.get<{ chunks?: unknown }>(STORAGE_KEY_V1);
    if (v1) return migrateV1ToV2(v1);
  } catch {
    /* fall through to empty */
  }
  return { version: 2, chunks: [], vectors: {} };
}

function persist(chunks: RagChunk[]) {
  const vectors: Record<string, QuantizedVector> = {};
  for (const chunk of chunks) {
    const qv = quantized.get(chunk.id);
    if (qv) vectors[chunk.id] = qv;
  }
  void platform()
    .storage.set<PersistShapeV2>(STORAGE_KEY_V2, { version: 2, chunks, vectors })
    .catch((err: unknown) => console.error('[ragStore] persist failed:', err));
}

// --- lexical index cache (per-project, rebuilt when chunks ref changes) ---
let indexCache: { chunksRef: RagChunk[]; byProject: Map<string, RagIndex> } | null = null;
function projectIndex(chunks: RagChunk[], projectId: string): RagIndex {
  if (!indexCache || indexCache.chunksRef !== chunks) {
    indexCache = { chunksRef: chunks, byProject: new Map() };
  }
  let index = indexCache.byProject.get(projectId);
  if (!index) {
    index = buildRagIndex(chunks.filter((chunk) => chunk.projectId === projectId));
    indexCache.byProject.set(projectId, index);
  }
  return index;
}

// --- background embedding ---
async function embedChunks(targets: RagChunk[]): Promise<boolean> {
  const provider = getEmbeddingProvider();
  await provider.warmup();
  if (!provider.ready || targets.length === 0) return false;
  let changed = false;
  for (let i = 0; i < targets.length; i += BACKFILL_BATCH) {
    const batch = targets.slice(i, i + BACKFILL_BATCH);
    const vectors = await provider.embed(batch.map(embedTextForChunk));
    if (vectors.length !== batch.length) continue;
    batch.forEach((chunk, j) => {
      const vec = vectors[j]!;
      quantized.set(chunk.id, quantize(vec));
      floatCache.set(chunk.id, vec);
      changed = true;
    });
  }
  return changed;
}

export const useRagStore = create<RagStore>((set, get) => ({
  chunks: [],
  hydrated: false,

  hydrate: async () => {
    const loaded = await loadPersisted();
    quantized.clear();
    floatCache.clear();
    for (const [id, qv] of Object.entries(loaded.vectors)) quantized.set(id, qv);

    // Clean any cross-project duplicates that predate global de-duplication, so
    // an existing store also becomes a single, library-grade corpus. Drop the
    // removed chunks' vectors and persist the collapsed set.
    const { chunks, removedIds } = dedupeChunks(loaded.chunks);
    if (removedIds.length > 0) {
      for (const id of removedIds) {
        quantized.delete(id);
        floatCache.delete(id);
      }
    }
    set({ chunks, hydrated: true });
    if (removedIds.length > 0) persist(chunks);

    // Backfill any chunk that has no vector yet (e.g. migrated v1 data), then
    // persist. Fire-and-forget; failures are silent (lexical still works).
    const missing = chunks.filter((chunk) => !quantized.has(chunk.id));
    if (missing.length > 0) {
      void embedChunks(missing).then((changed) => {
        if (changed) persist(get().chunks);
      });
    }
  },

  addChunks: (projectId, inputs) => {
    if (!projectId || inputs.length === 0) return;
    let fresh: RagChunk[] = [];
    set((state) => {
      const now = new Date().toISOString();
      // Index existing chunks by their GLOBAL identity (PMID/DOI/url/title), so
      // a record already in the library — even from another project — is not
      // stored again; its richer metadata is merged into the existing copy.
      const byKey = new Map<string, RagChunk>();
      for (const c of state.chunks) byKey.set(globalChunkKey(c), c);
      const merges = new Map<string, RagChunk>(); // existing id -> merged copy
      fresh = [];
      for (const input of inputs) {
        const candidate: RagChunk = { ...input, id: crypto.randomUUID(), projectId, createdAt: now };
        const key = globalChunkKey(candidate);
        const existing = byKey.get(key);
        if (existing) {
          const merged = mergeChunks(existing, candidate);
          if (merged !== existing) merges.set(existing.id, merged);
          continue; // already in the library — do not duplicate
        }
        byKey.set(key, candidate);
        fresh.push(candidate);
      }
      if (fresh.length === 0 && merges.size === 0) return state;
      const base = merges.size > 0 ? state.chunks.map((c) => merges.get(c.id) ?? c) : state.chunks;
      const chunks = [...fresh, ...base].slice(0, MAX_CHUNKS);
      persist(chunks);
      return { ...state, chunks };
    });
    // Embed the new chunks in the background, then re-persist with their vectors.
    if (fresh.length > 0) {
      void embedChunks(fresh).then((changed) => {
        if (changed) persist(get().chunks);
      });
    }
  },

  search: (projectId, query, limit = DEFAULT_SEARCH_LIMIT) =>
    searchRagIndex(projectIndex(get().chunks, projectId), query, limit),

  searchHybrid: async (activeProjectId, query, limit = DEFAULT_SEARCH_LIMIT, tag) => {
    const chunks = tag ? get().chunks.filter((c) => c.tag === tag) : get().chunks;
    if (chunks.length === 0 || !query.trim()) return [];
    // Widen the query with offline brand↔generic / abbreviation synonyms so a
    // search for one surface form ("Tylenol", "MI") matches findings written
    // with another. Feeds both the embedding and the lexical match.
    const expanded = expandQuery(query);
    let queryVector: Float32Array | null = null;
    try {
      const provider = getEmbeddingProvider();
      await provider.warmup();
      if (provider.ready) {
        // Embed the ORIGINAL query, not the synonym-expanded one: appending a
        // long list of brand/generic synonyms drifts the meaning vector away
        // from what the user actually asked, blunting semantic retrieval. The
        // expansion still widens the LEXICAL match below.
        const [vec] = await provider.embed([query]);
        queryVector = vec ?? null;
      }
    } catch {
      queryVector = null; // lexical-only fallback
    }
    return hybridSearch({ chunks, query: expanded, queryVector, vectorFor, activeProjectId, limit, diversify: true });
  },

  chunksForProject: (projectId) => get().chunks.filter((c) => c.projectId === projectId),

  removeChunk: (id) =>
    set((state) => {
      const chunks = state.chunks.filter((c) => c.id !== id);
      if (chunks.length === state.chunks.length) return state;
      quantized.delete(id);
      floatCache.delete(id);
      persist(chunks);
      return { ...state, chunks };
    }),

  clearProject: (projectId) =>
    set((state) => {
      const removed = state.chunks.filter((c) => c.projectId === projectId);
      if (removed.length === 0) return state;
      for (const c of removed) {
        quantized.delete(c.id);
        floatCache.delete(c.id);
      }
      const chunks = state.chunks.filter((c) => c.projectId !== projectId);
      persist(chunks);
      return { ...state, chunks };
    }),

  pruneProject: (projectId, keep) => {
    const before = get().chunks;
    const chunks = before.filter((c) => c.projectId !== projectId || keep(c));
    const removed = before.length - chunks.length;
    if (removed > 0) {
      const kept = new Set(chunks.map((c) => c.id));
      for (const c of before) {
        if (!kept.has(c.id)) {
          quantized.delete(c.id);
          floatCache.delete(c.id);
        }
      }
      persist(chunks);
      set({ chunks });
    }
    return removed;
  },
}));
