// Pure persistence helpers for the RAG store: int8 vector (de)quantisation and
// the rag.v1 -> rag.v2 schema migration. No I/O here — the store owns reads and
// writes; this module only transforms shapes, so it is fully unit-testable.

import type { RagChunk } from '../types';

export const RAG_SCHEMA_VERSION = 2;

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
