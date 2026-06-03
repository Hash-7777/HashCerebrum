// Pure persistence helpers for the RAG store: int8 vector (de)quantisation and
// the rag.v1 -> rag.v2 schema migration. No I/O here — the store owns reads and
// writes; this module only transforms shapes, so it is fully unit-testable.

import type { RagChunk } from '../types';

export const RAG_SCHEMA_VERSION = 3;

// A vector stored compactly: int8 components (base64) plus the per-vector scale
// used to map them back to float. ~384 bytes/vector vs ~1.5 KB for float32 JSON.
export interface QuantizedVector {
  /** base64 of the Int8Array components. */
  q: string;
  /** scale such that float[i] ≈ int8[i] * s. */
  s: number;
}

export interface PersistShapeV2 {
  version: number;
  chunks: RagChunk[];
  /** chunkId -> quantised embedding. Absent entries are (re)embedded lazily. */
  vectors: Record<string, QuantizedVector>;
}

function int8ToBase64(arr: Int8Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function base64ToInt8(b64: string): Int8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Int8Array(bytes.buffer);
}

/** Quantise a float vector to int8 + scale (lossy, but lossless enough for
 *  cosine ranking — relative magnitudes are preserved). */
export function quantize(vec: Float32Array): QuantizedVector {
  let max = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const abs = Math.abs(vec[i]!);
    if (abs > max) max = abs;
  }
  const s = max > 0 ? max / 127 : 1;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) {
    q[i] = Math.max(-127, Math.min(127, Math.round(vec[i]! / s)));
  }
  return { q: int8ToBase64(q), s };
}

/** Reconstruct an approximate float vector. Not re-normalised — cosineSim
 *  divides by magnitude, so ranking is unaffected. */
export function dequantize(qv: QuantizedVector): Float32Array {
  const q = base64ToInt8(qv.q);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i += 1) out[i] = q[i]! * qv.s;
  return out;
}

export function emptyShape(): PersistShapeV2 {
  return { version: RAG_SCHEMA_VERSION, chunks: [], vectors: {} };
}

function validChunks(value: unknown): RagChunk[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is RagChunk =>
      !!c && typeof (c as RagChunk).id === 'string' && typeof (c as RagChunk).projectId === 'string',
  );
}

function validVectors(value: unknown): Record<string, QuantizedVector> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, QuantizedVector> = {};
  for (const [id, v] of Object.entries(value as Record<string, unknown>)) {
    const qv = v as Partial<QuantizedVector>;
    if (qv && typeof qv.q === 'string' && typeof qv.s === 'number') out[id] = { q: qv.q, s: qv.s };
  }
  return out;
}

/** Normalise a persisted v2 blob into a sound shape (drops malformed rows). */
export function normalizeV2(raw: Partial<PersistShapeV2> | null | undefined): PersistShapeV2 {
  return {
    version: RAG_SCHEMA_VERSION,
    chunks: validChunks(raw?.chunks),
    vectors: validVectors(raw?.vectors),
  };
}

/** Migrate the legacy v1 blob ({ chunks }) forward. Chunks are preserved; no
 *  vectors yet — they are backfilled lazily once the embedder warms up. */
export function migrateV1ToV2(raw: { chunks?: unknown } | null | undefined): PersistShapeV2 {
  return { version: RAG_SCHEMA_VERSION, chunks: validChunks(raw?.chunks), vectors: {} };
}

// --- global de-duplication (turns memory into a library, not a per-project dump) ---

/**
 * Stable identity for an evidence record across ALL projects, so the same paper
 * saved while researching two different topics is stored once. PMID is the
 * strongest key, then DOI, then URL, then a normalised title. Answer chunks are
 * project-specific narrative and are never merged across projects — they key by
 * their own id.
 */
export function globalChunkKey(
  chunk: Pick<RagChunk, 'kind' | 'pmid' | 'doi' | 'url' | 'title' | 'id' | 'docId' | 'chunkIndex'>,
): string {
  // Imported-document passages dedupe by file content hash + passage index, so
  // re-importing the same file (even renamed) never duplicates its passages.
  if (chunk.kind === 'document') {
    return chunk.docId ? `doc:${chunk.docId}:${chunk.chunkIndex ?? 0}` : `id:${chunk.id}`;
  }
  if (chunk.kind !== 'evidence') return `id:${chunk.id}`;
  const pmid = chunk.pmid?.trim();
  if (pmid) return `pmid:${pmid}`;
  const doi = chunk.doi?.trim().toLowerCase();
  if (doi) return `doi:${doi}`;
  const url = chunk.url?.trim().toLowerCase();
  if (url) return `url:${url}`;
  return `title:${chunk.title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * Merge a duplicate's richer metadata into the kept chunk without changing the
 * kept chunk's identity (id / projectId / createdAt / vector stay valid).
 * Returns the original `keep` reference unchanged when nothing was added, so
 * callers can cheaply detect a real change.
 */
export function mergeChunks(keep: RagChunk, dup: RagChunk): RagChunk {
  const merged: RagChunk = { ...keep };
  let changed = false;
  if (merged.year === undefined && dup.year !== undefined) {
    merged.year = dup.year;
    changed = true;
  }
  if (!merged.pmid && dup.pmid) {
    merged.pmid = dup.pmid;
    changed = true;
  }
  if (!merged.doi && dup.doi) {
    merged.doi = dup.doi;
    changed = true;
  }
  if (!merged.url && dup.url) {
    merged.url = dup.url;
    changed = true;
  }
  if ((!merged.authors || merged.authors.length === 0) && dup.authors && dup.authors.length > 0) {
    merged.authors = dup.authors;
    changed = true;
  }
  if (merged.evidenceStrength === undefined && dup.evidenceStrength !== undefined) {
    merged.evidenceStrength = dup.evidenceStrength;
    changed = true;
  }
  if (dup.text.length > merged.text.length) {
    merged.text = dup.text;
    changed = true;
  }
  return changed ? merged : keep;
}

/**
 * Collapse duplicate chunks (same globalChunkKey) keeping the first occurrence
 * and merging later duplicates' metadata into it. Returns the de-duplicated
 * list (first-seen order) and the ids that were removed (so their vectors can
 * be dropped).
 */
export function dedupeChunks(chunks: RagChunk[]): { chunks: RagChunk[]; removedIds: string[] } {
  const byKey = new Map<string, RagChunk>();
  const order: string[] = [];
  const removedIds: string[] = [];
  for (const chunk of chunks) {
    const key = globalChunkKey(chunk);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, chunk);
      order.push(key);
    } else {
      removedIds.push(chunk.id);
      byKey.set(key, mergeChunks(existing, chunk));
    }
  }
  return { chunks: order.map((key) => byKey.get(key)!), removedIds };
}
