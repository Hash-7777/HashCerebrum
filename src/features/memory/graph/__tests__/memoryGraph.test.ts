import { describe, expect, it } from 'vitest';
import type { RagChunk } from '@core/store/ragStore';
import { buildMemoryGraph, MAX_GRAPH_NODES } from '../memoryGraph';

function chunk(
  partial: Partial<RagChunk> & Pick<RagChunk, 'id' | 'title' | 'text'>,
): RagChunk {
  return {
    projectId: 'p1',
    kind: 'evidence',
    source: 'pubmed',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('buildMemoryGraph', () => {
  it('returns an empty graph for no chunks', () => {
    expect(buildMemoryGraph([])).toEqual({
      nodes: [],
      edges: [],
      clusters: [],
      stats: { savedChunks: 0, capsuleCount: 0, mergedChunks: 0, duplicateGroups: 0 },
    });
  });

  it('keeps unrelated chunks as separate memory capsules', () => {
    const graph = buildMemoryGraph([
      chunk({ id: 'a', title: 'Warfarin bleeding', text: 'anticoagulant risk' }),
      chunk({ id: 'b', title: 'Bone density', text: 'calcium intake' }),
    ]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.flatMap((n) => n.chunkIds).sort()).toEqual(['a', 'b']);
  });

  it('merges repeated answer memories for the same research topic', () => {
    const graph = buildMemoryGraph([
      chunk({
        id: 'answer-1',
        kind: 'answer',
        source: 'answer',
        title: 'Panadol liver safety answer',
        text: 'Panadol liver safety synthesis.',
        query: 'make a full research paper about panadol liver safety in elders',
      }),
      chunk({
        id: 'answer-2',
        kind: 'answer',
        source: 'answer',
        title: 'Panadol liver safety answer',
        text: 'Updated Panadol liver safety synthesis.',
        query: 'research about panadol liver safety in elders',
      }),
    ]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.chunkIds.sort()).toEqual(['answer-1', 'answer-2']);
    expect(graph.nodes[0]?.chunkCount).toBe(2);
    expect(graph.stats.mergedChunks).toBe(1);
    expect(graph.stats.duplicateGroups).toBe(1);
  });

  it('links chunks that share enough terms and leaves unrelated ones isolated', () => {
    const graph = buildMemoryGraph([
      chunk({
        id: 'nsaid-1',
        title: 'NSAID warfarin interaction bleeding risk',
        text: 'ibuprofen warfarin bleeding gastrointestinal risk anticoagulant',
      }),
      chunk({
        id: 'nsaid-2',
        title: 'Warfarin bleeding risk with NSAID therapy',
        text: 'naproxen warfarin bleeding gastrointestinal anticoagulant risk',
      }),
      chunk({
        id: 'unrelated',
        title: 'Photosynthesis chlorophyll absorption',
        text: 'plant leaves sunlight energy conversion',
      }),
    ]);
    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0]!;
    const endpointChunks = [edge.source, edge.target]
      .map((id) => graph.nodes.find((node) => node.id === id)?.chunkIds[0])
      .sort();
    expect(endpointChunks).toEqual(['nsaid-1', 'nsaid-2']);
    expect(edge.weight).toBeGreaterThan(0);
    expect(edge.label).toContain('warfarin');

    const degree = Object.fromEntries(graph.nodes.map((n) => [n.chunkIds[0], n.degree]));
    expect(degree['nsaid-1']).toBe(1);
    expect(degree['nsaid-2']).toBe(1);
    expect(degree['unrelated']).toBe(0);
  });

  it('does not connect findings only because manuscript filler words overlap', () => {
    const graph = buildMemoryGraph([
      chunk({
        id: 'drug',
        title: 'Warfarin anticoagulant bleeding signal',
        text: 'clinical evidence study results conclusion patient research',
      }),
      chunk({
        id: 'bone',
        title: 'Calcium fracture bone density',
        text: 'clinical evidence study results conclusion patient research',
      }),
    ]);

    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes.every((node) => node.degree === 0)).toBe(true);
  });

  it('groups sparse findings from the same research topic and labels the cluster', () => {
    const graph = buildMemoryGraph([
      chunk({
        id: 'run-a',
        title: 'Warfarin safety',
        text: 'anticoagulant pharmacology',
        runId: 'run-1',
        query: 'make a full research paper about NSAIDs and warfarin bleeding',
      }),
      chunk({
        id: 'run-b',
        title: 'Naproxen cohort',
        text: 'gastrointestinal event data',
        runId: 'run-1',
        query: 'make a full research paper about NSAIDs and warfarin bleeding',
      }),
    ]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.chunkCount).toBe(2);
    expect(graph.clusters).toHaveLength(1);
    expect(graph.clusters[0]?.label.toLowerCase()).toContain('nsaids');
    expect(graph.clusters[0]?.chunkCount).toBe(2);
  });

  it('caps the number of edges on any single node', () => {
    // One hub chunk plus many near-identical chunks all overlapping it.
    const hub = chunk({
      id: 'hub',
      title: 'serotonin dopamine norepinephrine receptor signalling pathway',
      text: 'serotonin dopamine norepinephrine receptor signalling pathway neuron',
      url: 'https://example.org/hub',
    });
    const spokes = Array.from({ length: 12 }, (_, i) =>
      chunk({
        id: `spoke-${i}`,
        title: `serotonin dopamine norepinephrine receptor signalling pathway variant ${i}`,
        text: `serotonin dopamine norepinephrine receptor signalling pathway neuron variant ${i}`,
        url: `https://example.org/spoke-${i}`,
      }),
    );
    const graph = buildMemoryGraph([hub, ...spokes]);
    const hubDegree = graph.nodes.find((n) => n.chunkIds.includes('hub'))!.degree;
    expect(hubDegree).toBeLessThanOrEqual(6);
  });

  it('keeps only the newest chunks past the node cap', () => {
    const many = Array.from({ length: MAX_GRAPH_NODES + 30 }, (_, i) =>
      chunk({
        id: `c${i}`,
        title: `Finding ${i}`,
        text: 'body',
        url: `https://example.org/finding-${i}`,
        // Higher index → later timestamp → newer.
        createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      }),
    );
    const graph = buildMemoryGraph(many);
    expect(graph.nodes).toHaveLength(MAX_GRAPH_NODES);
    // The very first (oldest) chunk must have been dropped.
    expect(graph.nodes.some((n) => n.chunkIds.includes('c0'))).toBe(false);
  });
});
