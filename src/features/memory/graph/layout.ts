// Force-directed layout for the memory graph, warped to fill a brain shape.
//
// The graph is laid out freely first — a normal Fruchterman–Reingold
// simulation with topic-anchor gravity and a gentle pull to the centre, which
// settles the disconnected topic clusters into one cohesive, evenly-filled
// blob. The settled blob is then normalized to a unit disc and warped through
// the brain silhouette, so the point cloud itself fills a brain. There is no
// hard boundary clamp — that was what piled the nodes into edge rings.
//
// Pure and deterministic (a golden-angle seed, no Math.random).

import { brainShape } from './brainShape';
import type { MemoryGraph } from './memoryGraph';

export interface NodePosition {
  x: number;
  y: number;
}

const ITERATIONS = 320;

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

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  // One anchor per topic cluster, in a tight spread near the centre. Global
  // gravity then fuses the clusters into a single blob with sub-regions.
  const clusterIds = [...new Set(graph.nodes.map((node) => node.clusterId))];
  const anchorRadius = span * 0.13;
  const anchorByCluster = new Map(
    clusterIds.map((id, i) => {
      if (clusterIds.length === 1) return [id, { x: cx, y: cy }];
      const t = i / (clusterIds.length - 1);
      const r = anchorRadius * Math.sqrt(t);
      const a = i * goldenAngle;
      return [id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }];
    }),
  );

  const index = new Map(graph.nodes.map((node, i) => [node.id, i]));

  // Seed each node in a small scatter around its topic's anchor.
  const pos: NodePosition[] = graph.nodes.map((node, i) => {
    const anchor = anchorByCluster.get(node.clusterId) ?? { x: cx, y: cy };
    const r = 6 + (i % 29) * 5;
    const a = i * goldenAngle;
    return { x: anchor.x + r * Math.cos(a), y: anchor.y + r * Math.sin(a) };
  });
  const disp: NodePosition[] = pos.map(() => ({ x: 0, y: 0 }));

  const edges = graph.edges
    .map((edge) => ({ a: index.get(edge.source), b: index.get(edge.target), weight: edge.weight }))
    .filter((edge): edge is { a: number; b: number; weight: number } =>
      edge.a !== undefined && edge.b !== undefined,
    );

  const ideal = Math.sqrt((span * span * 0.36) / n) * 0.9;
  let temperature = span * 0.07;
  const cooling = temperature / (ITERATIONS + 1);

  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    for (let i = 0; i < n; i += 1) {
      disp[i]!.x = 0;
      disp[i]!.y = 0;
    }

    // Repulsion between every pair — fills the blob evenly.
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

    for (let i = 0; i < n; i += 1) {
      // Topic gravity keeps a cluster in its region; global gravity holds the
      // disconnected clusters together as one blob.
      const anchor = anchorByCluster.get(graph.nodes[i]!.clusterId) ?? { x: cx, y: cy };
      disp[i]!.x += (anchor.x - pos[i]!.x) * 0.05 + (cx - pos[i]!.x) * 0.012;
      disp[i]!.y += (anchor.y - pos[i]!.y) * 0.05 + (cy - pos[i]!.y) * 0.012;
    }

    for (let i = 0; i < n; i += 1) {
      const magnitude = Math.max(Math.hypot(disp[i]!.x, disp[i]!.y), 0.01);
      const step = Math.min(magnitude, temperature);
      pos[i]!.x += (disp[i]!.x / magnitude) * step;
      pos[i]!.y += (disp[i]!.y / magnitude) * step;
    }
    temperature = Math.max(temperature - cooling, 0.6);
  }

  // Normalize the settled blob to a unit disc (centroid + max radius), then
  // warp it through the brain silhouette so the cloud fills a brain.
  let centroidX = 0;
  let centroidY = 0;
  for (const point of pos) {
    centroidX += point.x;
    centroidY += point.y;
  }
  centroidX /= n;
  centroidY /= n;
  let maxRadius = 1e-6;
  for (const point of pos) {
    maxRadius = Math.max(maxRadius, Math.hypot(point.x - centroidX, point.y - centroidY));
  }
  const scale = 1 / (maxRadius * 1.03);

  graph.nodes.forEach((node, i) => {
    const discX = (pos[i]!.x - centroidX) * scale;
    const discY = (pos[i]!.y - centroidY) * scale;
    result.set(node.id, brain.mapInto(discX, discY));
  });
  return result;
}
