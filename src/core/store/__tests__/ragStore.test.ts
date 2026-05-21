import { describe, expect, it } from 'vitest';
import { lexicalSearch, type RagChunk } from '../ragStore';

function chunk(partial: Partial<RagChunk> & Pick<RagChunk, 'id' | 'title' | 'text'>): RagChunk {
  return {
    projectId: 'p1',
    kind: 'evidence',
    source: 'pubmed',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('lexicalSearch', () => {
  it('returns nothing for an empty or stopword-only query', () => {
    const chunks = [chunk({ id: 'a', title: 'Dopamine pathways', text: 'striatal dopamine' })];
    expect(lexicalSearch(chunks, '', 8)).toEqual([]);
    expect(lexicalSearch(chunks, 'the and of to', 8)).toEqual([]);
  });

  it('ranks a title match above a body-only match', () => {
    const titleHit = chunk({ id: 'title', title: 'Hippocampus and memory', text: 'unrelated body' });
    const bodyHit = chunk({ id: 'body', title: 'Unrelated heading', text: 'the hippocampus encodes memory' });
    const hits = lexicalSearch([bodyHit, titleHit], 'hippocampus', 8);
    expect(hits.map((h) => h.chunk.id)).toEqual(['title', 'body']);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('drops chunks with no overlap (score 0)', () => {
    const chunks = [
      chunk({ id: 'match', title: 'Serotonin receptors', text: 'serotonin signalling' }),
      chunk({ id: 'miss', title: 'Bone density', text: 'calcium metabolism' }),
    ];
    const hits = lexicalSearch(chunks, 'serotonin', 8);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.chunk.id).toBe('match');
  });

  it('respects the result limit', () => {
    const chunks = Array.from({ length: 5 }, (_, i) =>
      chunk({ id: `c${i}`, title: 'Cortex study', text: 'cortex cortex' }),
    );
    expect(lexicalSearch(chunks, 'cortex', 2)).toHaveLength(2);
    expect(lexicalSearch(chunks, 'cortex', 0)).toEqual([]);
  });

  it('accumulates score across multiple distinct query terms', () => {
    const both = chunk({ id: 'both', title: 'Amygdala fear conditioning', text: '' });
    const one = chunk({ id: 'one', title: 'Amygdala anatomy', text: '' });
    const hits = lexicalSearch([one, both], 'amygdala fear', 8);
    expect(hits[0]!.chunk.id).toBe('both');
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('pulls same-run topic neighbours after finding a strong seed hit', () => {
    const seed = chunk({
      id: 'seed',
      title: 'Warfarin bleeding signal',
      text: 'anticoagulant interaction',
      runId: 'run-1',
      query: 'NSAIDs and warfarin bleeding risk',
    });
    const neighbour = chunk({
      id: 'neighbour',
      title: 'Naproxen cohort',
      text: 'gastrointestinal event rates',
      runId: 'run-1',
      query: 'NSAIDs and warfarin bleeding risk',
    });
    const unrelated = chunk({
      id: 'unrelated',
      title: 'Calcium and bone density',
      text: 'fracture prevention',
      runId: 'run-2',
      query: 'calcium fracture prevention',
    });

    const hits = lexicalSearch([unrelated, neighbour, seed], 'warfarin bleeding', 3);

    expect(hits.map((hit) => hit.chunk.id)).toContain('seed');
    expect(hits.map((hit) => hit.chunk.id)).toContain('neighbour');
    expect(hits.map((hit) => hit.chunk.id)).not.toContain('unrelated');
  });
});
