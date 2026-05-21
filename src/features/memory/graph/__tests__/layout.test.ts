import { describe, expect, it } from 'vitest';
import type { RagChunk } from '@core/store/ragStore';
import type { MemoryGraph } from '../memoryGraph';
import { layoutMemoryGraph } from '../layout';

function chunk(id: string): RagChunk {
  return {
    id,
    projectId: 'p1',
    kind: 'evidence',
    title: id,
    text: id,
    source: 'pubmed',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('layoutMemoryGraph', () => {
  it('keeps topic clusters separated with finite positions', () => {
    const graph: MemoryGraph = {
      clusters: [
        { id: 'c1', label: 'Warfarin', nodeIds: ['a', 'b'], terms: ['warfarin'] },
        { id: 'c2', label: 'Calcium', nodeIds: ['c', 'd'], terms: ['calcium'] },
      ],
      nodes: [
        { id: 'a', chunk: chunk('a'), label: 'a', degree: 1, clusterId: 'c1', topicTerms: ['warfarin'] },
        { id: 'b', chunk: chunk('b'), label: 'b', degree: 1, clusterId: 'c1', topicTerms: ['warfarin'] },
        { id: 'c', chunk: chunk('c'), label: 'c', degree: 1, clusterId: 'c2', topicTerms: ['calcium'] },
        { id: 'd', chunk: chunk('d'), label: 'd', degree: 1, clusterId: 'c2', topicTerms: ['calcium'] },
      ],
      edges: [
        { source: 'a', target: 'b', weight: 0.8, reason: 'same_topic', label: 'same topic' },
        { source: 'c', target: 'd', weight: 0.8, reason: 'same_topic', label: 'same topic' },
      ],
    };

    const positions = layoutMemoryGraph(graph, 900);
    expect(positions.size).toBe(4);
    for (const point of positions.values()) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }

    const c1x = (positions.get('a')!.x + positions.get('b')!.x) / 2;
    const c2x = (positions.get('c')!.x + positions.get('d')!.x) / 2;
    const c1y = (positions.get('a')!.y + positions.get('b')!.y) / 2;
    const c2y = (positions.get('c')!.y + positions.get('d')!.y) / 2;
    expect(Math.hypot(c1x - c2x, c1y - c2y)).toBeGreaterThan(180);
  });
});
