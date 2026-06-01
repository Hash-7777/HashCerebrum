import { describe, expect, it } from 'vitest';
import { cosineSim } from '../search/cosine';
import {
  dequantize,
  migrateV1ToV2,
  normalizeV2,
  quantize,
  type PersistShapeV2,
  type QuantizedVector,
} from '../store/persistence';
import type { RagChunk } from '../types';

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

describe('migration & normalisation', () => {
  it('migrates the legacy v1 { chunks } blob to v2 with empty vectors', () => {
    const v1 = {
      chunks: [
        { id: '1', projectId: 'p', kind: 'evidence', title: 't', text: 'x', source: 'pubmed', createdAt: '2020' },
      ],
    };
    const v2 = migrateV1ToV2(v1);
    expect(v2.version).toBe(2);
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
