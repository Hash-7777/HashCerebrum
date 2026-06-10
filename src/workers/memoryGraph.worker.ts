// Memory graph Web Worker — offloads the O(N²) edge computation and force
// layout from the UI thread so the graph stays interactive even with hundreds
// of nodes. Input: RagChunk[] + span. Output: serialised graph + positions.

import { buildMemoryGraph } from '../features/memory/graph/memoryGraph';
import { layoutMemoryGraph } from '../features/memory/graph/layout';
import type { RagChunk } from '../core/rag/types';

interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
const ctx = globalThis as unknown as WorkerScope;

ctx.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as {
    type?: string;
    id?: number;
    chunks?: RagChunk[];
    span?: number;
    maxNodes?: number;
  } | null;
  if (!msg || msg.type !== 'build' || typeof msg.id !== 'number' || !Array.isArray(msg.chunks)) return;

  try {
    // Low-end cap: clamp chunks to maxNodes before building.
    const maxNodes = msg.maxNodes ?? 240;
    const chunks = msg.chunks.slice(0, maxNodes);
    const graph = buildMemoryGraph(chunks);
    const span = msg.span ?? Math.max(1200, Math.sqrt(graph.nodes.length) * 110);
    const positions = layoutMemoryGraph(graph, span);

    // Structured clone handles Arrays fine; convert Maps to arrays of tuples.
    ctx.postMessage({
      type: 'built',
      id: msg.id,
      graph: {
        nodes: graph.nodes,
        edges: graph.edges,
        clusters: graph.clusters,
        stats: graph.stats,
      },
      positions: Array.from(positions.entries()),
      span,
    });
  } catch (err) {
    ctx.postMessage({ type: 'error', id: msg.id, error: String(err) });
  }
});
