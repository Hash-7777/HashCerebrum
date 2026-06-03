import { describe, expect, it } from 'vitest';
import { cosineSim } from '../search/cosine';
import {
  dedupeChunks,
  dequantize,
  globalChunkKey,
  mergeChunks,
  migrateV1ToV2,
  normalizeV2,
  quantize,
  RAG_SCHEMA_VERSION,
  type PersistShapeV2,
  type QuantizedVector,
} from '../store/persistence';
import type { RagChunk } from '../types';

function ragChunk(partial: Partial<RagChunk> & { id: string }): RagChunk {
  return {
    projectId: 'p1',
    kind: 'evidence',
    title: 'A record',
    text: 'body',
    source: 'pubmed',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('quantize / dequantize', () => {
  it('round-trips a 384-dim vector with near-perfect cosine fidelity', () => {
    const v = Float32Array.from(Array.from({ length: 384 }, (_, i) => Math.sin(i) * 0.5));
    const back = dequantize(quantize(v));
    expect(back.length).toBe(384);
    expect(cosineSim(v, back)).toBeGreaterThan(0.999);
  });

  it('handles a zero vector without NaNs', () => {
    const back = dequantize(quantize(new Float32Array(8)));
    expect(Array.from(back)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('global de-duplication', () => {
  it('keys evidence by PMID, then DOI, then url, then normalised title', () => {
    expect(globalChunkKey(ragChunk({ id: 'a', pmid: '123', doi: '10.1/x' }))).toBe('pmid:123');
    expect(globalChunkKey(ragChunk({ id: 'b', doi: '10.1/X' }))).toBe('doi:10.1/x');
    expect(globalChunkKey(ragChunk({ id: 'c', url: 'https://E.com' }))).toBe('url:https://e.com');
    expect(globalChunkKey(ragChunk({ id: 'd', title: '  Warfarin   Risk ' }))).toBe('title:warfarin risk');
    // Answers are project narrative — never merged across projects.
    expect(globalChunkKey(ragChunk({ id: 'e', kind: 'answer' }))).toBe('id:e');
  });

  it('collapses the same PMID saved under different projects into one chunk', () => {
    const a = ragChunk({ id: 'a', projectId: 'p1', pmid: '99', year: 2020 });
    const b = ragChunk({ id: 'b', projectId: 'p2', pmid: '99', doi: '10.1/y', authors: ['Smith'] });
    const { chunks, removedIds } = dedupeChunks([a, b]);
    expect(chunks).toHaveLength(1);
    expect(removedIds).toEqual(['b']);
    // The kept chunk keeps its identity but gains the duplicate's richer metadata.
    expect(chunks[0]!.id).toBe('a');
    expect(chunks[0]!.doi).toBe('10.1/y');
    expect(chunks[0]!.authors).toEqual(['Smith']);
    expect(chunks[0]!.year).toBe(2020);
  });

  it('mergeChunks returns the original reference when nothing is added', () => {
    const keep = ragChunk({ id: 'a', pmid: '1', year: 2021, authors: ['X'] });
    const dup = ragChunk({ id: 'b', pmid: '1' });
    expect(mergeChunks(keep, dup)).toBe(keep);
  });
});

describe('migration & normalisation', () => {
  it('migrates the legacy v1 { chunks } blob forward to the current schema with empty vectors', () => {
    const v1 = {
      chunks: [
        { id: '1', projectId: 'p', kind: 'evidence', title: 't', text: 'x', source: 'pubmed', createdAt: '2020' },
      ],
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.version).toBe(RAG_SCHEMA_VERSION);
    expect(v2.chunks).toHaveLength(1);
    expect(v2.vectors).toEqual({});
  });

  it('drops malformed chunks and vectors in normalizeV2', () => {
    const raw = {
      chunks: [{ id: '1', projectId: 'p' }, null],
      vectors: { good: { q: 'AAA', s: 0.5 }, bad: { q: 123 } },
    } as unknown as Partial<PersistShapeV2>;
    const out = normalizeV2(raw);
    expect(out.chunks).toHaveLength(1);
    expect(out.vectors.good).toBeDefined();
    expect((out.vectors as Record<string, QuantizedVector>).bad).toBeUndefined();
  });

  it('keeps the new optional medical metadata fields intact', () => {
    const chunk: RagChunk = {
      id: '2',
      projectId: 'p',
      kind: 'evidence',
      title: 'Statins',
      text: 'CoQ10',
      source: 'pubmed',
      createdAt: '2024',
      year: 2024,
      pmid: '12345',
      doi: '10.1/x',
      authors: ['A', 'B'],
      evidenceStrength: 'strong',
    };
    const out = normalizeV2({ version: 2, chunks: [chunk], vectors: {} });
    expect(out.chunks[0]!.pmid).toBe('12345');
    expect(out.chunks[0]!.evidenceStrength).toBe('strong');
  });
});
