import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { RagChunk } from '@core/rag';
import type { Manuscript } from '@features/brain/swarm/manuscript';
import {
  setRagChunks,
  getRagChunks,
  observeRagChunks,
  pushRagChunk,
  setManuscript,
  getManuscript,
  observeManuscript,
  setAnnotations,
  getAnnotations,
  observeAnnotations,
  pushAnnotation,
  getProjectSyncState,
  setProjectSyncState,
} from '../sync';
import type { BrainAnnotation } from '../sync';

describe('collab sync', () => {
  const makeDoc = () => new Y.Doc();

  it('round-trips RAG chunks', () => {
    const doc = makeDoc();
    const chunks: RagChunk[] = [
      { id: 'c1', projectId: 'p1', kind: 'evidence', title: 'T1', text: 'text', source: 'pubmed', createdAt: '2024-01-01' },
    ];
    setRagChunks(doc, chunks);
    expect(getRagChunks(doc)).toHaveLength(1);
    expect(getRagChunks(doc)[0]!.id).toBe('c1');
  });

  it('observes RAG chunk changes', () => {
    const doc = makeDoc();
    const cb = vi.fn();
    const off = observeRagChunks(doc, cb);
    pushRagChunk(doc, { id: 'c2', projectId: 'p1', kind: 'answer', title: 'T2', text: 't', source: 'answer', createdAt: '2024-01-02' });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('round-trips manuscript', () => {
    const doc = makeDoc();
    const manuscript: Manuscript = {
      title: 'Paper',
      abstract: { background: 'bg', objective: 'obj', methods: 'm', results: 'r', conclusions: 'c' },
      keywords: ['k1'],
      sections: [{ heading: 'Intro', body: ['p1'] }],
    };
    setManuscript(doc, manuscript);
    const result = getManuscript(doc);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Paper');
    expect(result!.sections[0]!.heading).toBe('Intro');
  });

  it('observes manuscript changes', () => {
    const doc = makeDoc();
    const cb = vi.fn();
    const off = observeManuscript(doc, cb);
    setManuscript(doc, {
      title: 'X',
      abstract: { background: '', objective: '', methods: '', results: '', conclusions: '' },
      keywords: [],
      sections: [],
    });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('round-trips annotations', () => {
    const doc = makeDoc();
    const annotations: BrainAnnotation[] = [
      { id: 'a1', projectId: 'p1', regionId: 'frontal', text: 'note', createdAt: '2024-01-01', authorId: 'u1' },
    ];
    setAnnotations(doc, annotations);
    expect(getAnnotations(doc)).toHaveLength(1);
  });

  it('observes annotation changes', () => {
    const doc = makeDoc();
    const cb = vi.fn();
    const off = observeAnnotations(doc, cb);
    pushAnnotation(doc, { id: 'a2', projectId: 'p1', regionId: 'temporal', text: 'n', createdAt: '2024-01-02', authorId: 'u2' });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('getProjectSyncState returns combined state', () => {
    const doc = makeDoc();
    setProjectSyncState(doc, { ragChunks: [], manuscript: null, annotations: [] });
    const state = getProjectSyncState(doc);
    expect(state.ragChunks).toEqual([]);
    expect(state.manuscript).toBeNull();
    expect(state.annotations).toEqual([]);
  });
});
