// Force-directed layout for the memory graph, constrained to a brain shape.
//
// Topic clusters are disconnected components — laid out freely they fly apart
// into scattered blobs. Instead, every node is laid out by a single
// Fruchterman–Reingold simulation whose displacement is clamped, every
// iteration, to stay inside a brain silhouette. Each topic is pulled toward
// its own anchor point so it settles into a region of the brain, and the
// brain boundary holds the whole map together as one coherent shape.
//
// Pure and deterministic (a golden-angle seed, no Math.random), so the same
// memory always renders the same brain.

import { brainShape } from './brainShape';
import type { MemoryGraph } from './memoryGraph';

export interface NodePosition {
  x: number;
  y: number;
}

const ITERATIONS = 340;

export function layoutMemoryGraph(graph: MemoryGraph, span: number): Map<string, NodePosition> {
  const result = new Map<string, NodePosition>();
  const n = graph.nodes.length;
  if (n === 0) return result;

  const brain = brainShape(span);
  const cx = span / 2;
  const cy = span / 2;
  if (n === 1) {
    result.set(graph.nodes[0]!.id, { x: cx, y: cy });
    return result;
  }

  // One anchor per topic cluster, spread through the brain interior.
  const clusterIds = [...new Set(graph.nodes.map((node) => node.clusterId))];
  const anchorList = brain.anchors(clusterIds.length);
  const anchorByCluster = new Map(
    clusterIds.map((id, i) => [id, anchorList[i] ?? { x: cx, y: cy }]),
  );

  const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  // Seed each node in a small scatter around its topic's anchor.
  const pos: NodePosition[] = graph.nodes.map((node, i) => {
    const anchor = anchorByCluster.get(node.clusterId) ?? { x: cx, y: cy };
    const r = 8 + (i % 23) * 4;
    const angle = i * goldenAngle;
    return brain.clampInside(anchor.x + r * Math.cos(angle), anchor.y + r * Math.sin(angle));
  });
  const disp: NodePosition[] = pos.map(() => ({ x: 0, y: 0 }));

  // Ideal spacing derived from the brain's usable area and the node count.
  const ideal = Math.sqrt((span * span * 0.42) / n) * 0.82;
  let temperature = span * 0.085;
  const cooling = temperature / (ITERATIONS + 1);

  const edges = graph.edges
    .map((edge) => ({ a: index.get(edge.source), b: index.get(edge.target), weight: edge.weight }))
    .filter((edge): edge is { a: number; b: number; weight: number } =>
      edge.a !== undefined && edge.b !== undefined,
    );

  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    for (let i = 0; i < n; i += 1) {
      disp[i]!.x = 0;
      disp[i]!.y = 0;
    }

    // Repulsion between every pair of nodes.
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = pos[i]!.x - pos[j]!.x;
        let dy = pos[i]!.y - pos[j]!.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          dx = (i - j) * 0.02 + 0.02;
          dy = 0.017;
          dist = Math.hypot(dx, dy);
        }
        const force = (ideal * ideal) / dist;
        const ux = dx / dist;
        const uy = dy / dist;
        disp[i]!.x += ux * force;
        disp[i]!.y += uy * force;
        disp[j]!.x -= ux * force;
        disp[j]!.y -= uy * force;
      }
    }

    // Attraction along edges — a stronger link pulls harder.
    for (const edge of edges) {
      const dx = pos[edge.a]!.x - pos[edge.b]!.x;
      const dy = pos[edge.a]!.y - pos[edge.b]!.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const force = ((dist * dist) / ideal) * (0.5 + edge.weight);
      const ux = dx / dist;
      const uy = dy / dist;
      disp[edge.a]!.x -= ux * force;
      disp[edge.a]!.y -= uy * force;
      disp[edge.b]!.x += ux * force;
      disp[edge.b]!.y += uy * force;
    }

    // Topic gravity — keeps each cluster settled in its brain region.
    for (let i = 0; i < n; i += 1) {
      const anchor = anchorByCluster.get(graph.nodes[i]!.clusterId) ?? { x: cx, y: cy };
      disp[i]!.x += (anchor.x - pos[i]!.x) * 0.028;
      disp[i]!.y += (anchor.y - pos[i]!.y) * 0.028;
    }

    // Apply displacement (capped by temperature), then clamp every node back
    // inside the brain silhouette so the map keeps its shape.
    for (let i = 0; i < n; i += 1) {
      const magnitude = Math.max(Math.hypot(disp[i]!.x, disp[i]!.y), 0.01);
      const step = Math.min(magnitude, temperature);
      const nextX = pos[i]!.x + (disp[i]!.x / magnitude) * step;
      const nextY = pos[i]!.y + (disp[i]!.y / magnitude) * step;
      const inside = brain.clampInside(nextX, nextY);
      pos[i]!.x = inside.x;
      pos[i]!.y = inside.y;
    }
    temperature = Math.max(temperature - cooling, 0.6);
  }

  graph.nodes.forEach((node, i) => result.set(node.id, { x: pos[i]!.x, y: pos[i]!.y }));
  return result;
}
