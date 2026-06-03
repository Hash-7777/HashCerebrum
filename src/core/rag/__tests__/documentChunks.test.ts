import { describe, expect, it } from 'vitest';
import type { RagChunk } from '../types';
import { dedupeChunks, globalChunkKey } from '../store/persistence';

function docChunk(docId: string, chunkIndex: number, text = 'passage'): RagChunk {
  return {
    id: `${docId}-${chunkIndex}-${Math.random()}`,
    projectId: 'p1',
    kind: 'document',
    title: 'Imported paper',
    text,
    source: 'library',
    createdAt: new Date().toISOString(),
    docId,
    chunkIndex,
  };
}

describe('globalChunkKey — documents', () => {
  it('keys a document passage by docId + chunkIndex', () => {
    expect(globalChunkKey(docChunk('abc', 2))).toBe('doc:abc:2');
  });
  it('falls back to id when docId is missing', () => {
    const c = docChunk('x', 0);
    delete c.docId;
    expect(globalChunkKey(c)).toBe(`id:${c.id}`);
  });
});

describe('dedupeChunks — re-import is a no-op', () => {
  it('collapses identical document passages from a re-import', () => {
    const first = [docChunk('hash1', 0), docChunk('hash1', 1)];
    const reimport = [docChunk('hash1', 0), docChunk('hash1', 1)];
    const { chunks, removedIds } = dedupeChunks([...first, ...reimport]);
    expect(chunks).toHaveLength(2);
    expect(removedIds).toHaveLength(2);
  });

  it('keeps passages from different documents', () => {
    const { chunks } = dedupeChunks([docChunk('h1', 0), docChunk('h2', 0)]);
    expect(chunks).toHaveLength(2);
  });
});
