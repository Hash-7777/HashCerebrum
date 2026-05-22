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

function graphNode(id: string, clusterId: string, topicTerms: string[], degree: number) {
  const source = chunk(id);
  return {
    id,
    chunk: source,
    chunks: [source],
    chunkIds: [id],
    chunkCount: 1,
    label: id,
    degree,
    clusterId,
    topicTerms,
  };
}

describe('layoutMemoryGraph', () => {
  it('keeps topic clusters separated with finite positions', () => {
    const graph: MemoryGraph = {
      clusters: [
        { id: 'c1', label: 'Warfarin', nodeIds: ['a', 'b'], chunkCount: 2, terms: ['warfarin'] },
        { id: 'c2', label: 'Calcium', nodeIds: ['c', 'd'], chunkCount: 2, terms: ['calcium'] },
      ],
      nodes: [
        graphNode('a', 'c1', ['warfarin'], 1),
        graphNode('b', 'c1', ['warfarin'], 1),
        graphNode('c', 'c2', ['calcium'], 1),
        graphNode('d', 'c2', ['calcium'], 1),
      ],
      edges: [
        { source: 'a', target: 'b', weight: 0.8, reason: 'same_topic', label: 'same topic' },
        { source: 'c', target: 'd', weight: 0.8, reason: 'same_topic', label: 'same topic' },
      ],
      stats: { savedChunks: 4, capsuleCount: 4, mergedChunks: 0, duplicateGroups: 0 },
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

  it('does not pin dense graphs to the virtual canvas border', () => {
    const graph: MemoryGraph = {
      clusters: [{ id: 'dense', label: 'Dense topic', nodeIds: [], chunkCount: 0, terms: ['dense'] }],
      nodes: [],
      edges: [],
      stats: { savedChunks: 80, capsuleCount: 80, mergedChunks: 0, duplicateGroups: 0 },
    };
    graph.nodes = Array.from({ length: 80 }, (_, index) => {
      const id = `n${index}`;
      graph.clusters[0]!.nodeIds.push(id);
      graph.clusters[0]!.chunkCount += 1;
      return graphNode(id, 'dense', ['dense'], 6);
    });
    graph.edges = graph.nodes.slice(1).map((node) => ({
      source: graph.nodes[0]!.id,
      target: node.id,
      weight: 0.6,
      reason: 'same_topic',
      label: 'same topic',
    }));

    const positions = layoutMemoryGraph(graph, 1200);
    const pinned = [...positions.values()].filter(
      (point) =>
        Math.abs(point.x - 32) < 0.001 ||
        Math.abs(point.x - 1168) < 0.001 ||
        Math.abs(point.y - 32) < 0.001 ||
        Math.abs(point.y - 1168) < 0.001,
    );

    expect(pinned).toHaveLength(0);
  });

  it('spreads a dense single topic into an interpretable constellation', () => {
    const graph: MemoryGraph = {
      clusters: [{ id: 'dense', label: 'Dense topic', nodeIds: [], chunkCount: 0, terms: ['dense'] }],
      nodes: [],
      edges: [],
      stats: { savedChunks: 64, capsuleCount: 64, mergedChunks: 0, duplicateGroups: 0 },
    };
    graph.nodes = Array.from({ length: 64 }, (_, index) => {
      const id = `n${index}`;
      graph.clusters[0]!.nodeIds.push(id);
      graph.clusters[0]!.chunkCount += 1;
      return graphNode(id, 'dense', ['dense'], 4);
    });
    graph.edges = graph.nodes.slice(1).map((node) => ({
      source: graph.nodes[0]!.id,
      target: node.id,
      weight: 0.7,
      reason: 'same_topic',
      label: 'same topic',
    }));

    const positions = layoutMemoryGraph(graph, 1200);
    const xs = [...positions.values()].map((point) => point.x);
    const ys = [...positions.values()].map((point) => point.y);

    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(260);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(220);
  });
});
