import { describe, expect, it } from 'vitest';
import { hybridSearch } from '../search/hybrid';
import type { RagChunk } from '../types';

function chunk(id: string, projectId: string, title: string, text: string): RagChunk {
  return { id, projectId, kind: 'evidence', title, text, source: 'pubmed', createdAt: '2024-01-01' };
}

describe('hybridSearch', () => {
  it('finds the semantically nearest chunk even when the query shares no keywords', () => {
    const chunks = [
      chunk('a', 'p', 'Cardiac', 'myocardial infarction outcomes'),
      chunk('b', 'p', 'Derm', 'unrelated dermatology topic'),
      chunk('c', 'p', 'Misc', 'random unrelated text'),
    ];
    const vectors: Record<string, Float32Array> = {
      a: Float32Array.from([1, 0, 0]),
      b: Float32Array.from([0, 1, 0]),
      c: Float32Array.from([0, 0, 1]),
    };
    // "heart attack" overlaps none of the texts lexically — semantic must win.
    const queryVector = Float32Array.from([0.95, 0.1, 0]);
    const hits = hybridSearch({
      chunks,
      query: 'heart attack',
      queryVector,
      vectorFor: (id) => vectors[id],
      activeProjectId: 'p',
      limit: 3,
    });
    expect(hits[0]!.chunk.id).toBe('a');
  });

  it('prefers the active project when two hits are otherwise comparable', () => {
    const chunks = [
      chunk('other', 'projOther', 'Aspirin', 'aspirin antiplatelet'),
      chunk('active', 'projActive', 'Aspirin', 'aspirin antiplatelet'),
    ];
    const queryVector = Float32Array.from([1, 0]);
    const hits = hybridSearch({
      chunks,
      query: 'aspirin',
      queryVector,
      vectorFor: () => Float32Array.from([1, 0]),
      activeProjectId: 'projActive',
      limit: 2,
    });
    expect(hits[0]!.chunk.projectId).toBe('projActive');
  });

  it('falls back to lexical ranking when no query vector is supplied', () => {
    const chunks = [
      chunk('hit', 'p', 'Warfarin bleeding', 'anticoagulant'),
      chunk('miss', 'p', 'Bone density', 'calcium'),
    ];
    const hits = hybridSearch({
      chunks,
      query: 'warfarin',
      queryVector: null,
      vectorFor: () => undefined,
      activeProjectId: 'p',
      limit: 5,
    });
    expect(hits[0]!.chunk.id).toBe('hit');
    expect(hits.some((h) => h.chunk.id === 'miss')).toBe(false);
  });
});
