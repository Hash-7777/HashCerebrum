// Force-directed layout for the memory graph.
//
// Topic clusters are disconnected components — laying the whole graph out with
// one global simulation flings them across an empty canvas. Instead, each
// cluster is laid out on its own with a small Fruchterman–Reingold simulation,
// then the cluster discs are circle-packed so the finished diagram is compact:
// no empty centre, no blobs marooned in black space.
//
// Pure and deterministic (a golden-angle seed, a deterministic packing spiral,
// no Math.random), so the same graph always lays out the same way.

import type { MemoryGraph, MemoryGraphEdge } from './memoryGraph';

export interface NodePosition {
  x: number;
  y: number;
}

const CLUSTER_ITERATIONS = 280;
const CLUSTER_GAP = 28; // breathing room between packed cluster discs

interface ClusterEdge {
  a: number;
  b: number;
  weight: number;
}

/**
 * Lay out one cluster on its own with Fruchterman–Reingold, centred on the
 * origin. Returns local node positions and the cluster's bounding radius.
 */
function layoutCluster(
  nodeIds: string[],
  edges: ClusterEdge[],
): { local: Map<string, NodePosition>; radius: number } {
  const n = nodeIds.length;
  const local = new Map<string, NodePosition>();
  if (n === 0) return { local, radius: 1 };
  if (n === 1) {
    local.set(nodeIds[0]!, { x: 0, y: 0 });
    return { local, radius: 26 };
  }

  // Golden-angle spiral seed.
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const seedRadius = 30 + Math.sqrt(n) * 26;
  const pos: NodePosition[] = nodeIds.map((_, i) => {
    const t = i / (n - 1);
    const r = seedRadius * Math.sqrt(t);
    const angle = i * goldenAngle;
    return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
  });
  const disp: NodePosition[] = pos.map(() => ({ x: 0, y: 0 }));
  const ideal = 42 + Math.sqrt(n) * 7; // ideal edge length
  let temperature = seedRadius;
  const cooling = temperature / (CLUSTER_ITERATIONS + 1);

  for (let iter = 0; iter < CLUSTER_ITERATIONS; iter += 1) {
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

    // Gentle gravity toward the cluster centre.
    for (let i = 0; i < n; i += 1) {
      disp[i]!.x += -pos[i]!.x * 0.02;
      disp[i]!.y += -pos[i]!.y * 0.02;
    }

    // Apply displacement, capped by the cooling temperature.
    for (let i = 0; i < n; i += 1) {
      const magnitude = Math.max(Math.hypot(disp[i]!.x, disp[i]!.y), 0.01);
      const step = Math.min(magnitude, temperature);
      pos[i]!.x += (disp[i]!.x / magnitude) * step;
      pos[i]!.y += (disp[i]!.y / magnitude) * step;
    }
    temperature = Math.max(temperature - cooling, 1);
  }

  // Recentre on the centroid and measure the bounding radius.
  let cx = 0;
  let cy = 0;
  for (const point of pos) {
    cx += point.x;
    cy += point.y;
  }
  cx /= n;
  cy /= n;
  let radius = 0;
  for (let i = 0; i < n; i += 1) {
    const x = pos[i]!.x - cx;
    const y = pos[i]!.y - cy;
    local.set(nodeIds[i]!, { x, y });
    radius = Math.max(radius, Math.hypot(x, y));
  }
  return { local, radius: radius + 32 };
}

/**
 * Circle-pack the cluster discs: the largest cluster sits at the centre, and
 * each remaining cluster is placed at the spiral position nearest the centre
 * that does not overlap an already-placed disc. This keeps the whole diagram
 * compact instead of strung out around an empty middle.
 */
function packClusters(items: { id: string; radius: number }[]): Map<string, NodePosition> {
  const centers = new Map<string, NodePosition>();
  const placed: { x: number; y: number; r: number }[] = [];
  const order = [...items].sort((a, b) => b.radius - a.radius);
  const minRadius = order.length > 0 ? order[order.length - 1]!.radius : 20;
  const step = Math.max(14, minRadius * 0.5);

  for (const item of order) {
    if (placed.length === 0) {
      centers.set(item.id, { x: 0, y: 0 });
      placed.push({ x: 0, y: 0, r: item.radius });
      continue;
    }
    let chosen: NodePosition | null = null;
    for (let distance = step; distance < 200000 && !chosen; distance += step) {
      const samples = Math.max(10, Math.round((2 * Math.PI * distance) / step));
      for (let s = 0; s < samples; s += 1) {
        const angle = (s / samples) * Math.PI * 2;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance;
        let fits = true;
        for (const disc of placed) {
          if (Math.hypot(x - disc.x, y - disc.y) < disc.r + item.radius + CLUSTER_GAP) {
            fits = false;
            break;
          }
        }
        if (fits) {
          chosen = { x, y };
          break;
        }
      }
    }
    const center = chosen ?? { x: 0, y: 0 };
    centers.set(item.id, center);
    placed.push({ x: center.x, y: center.y, r: item.radius });
  }
  return centers;
}

/**
 * Lay the graph out: each topic cluster is laid out locally, the clusters are
 * circle-packed, and the result is scaled to roughly fill `span`. The caller
 * fits the result into its viewport with a pan/zoom transform.
 */
export function layoutMemoryGraph(graph: MemoryGraph, span: number): Map<string, NodePosition> {
  const result = new Map<string, NodePosition>();
  if (graph.nodes.length === 0) return result;

  // Group node ids by cluster, and remember each node's cluster.
  const byCluster = new Map<string, string[]>();
  const clusterOf = new Map<string, string>();
  for (const node of graph.nodes) {
    clusterOf.set(node.id, node.clusterId);
    const list = byCluster.get(node.clusterId) ?? [];
    list.push(node.id);
    byCluster.set(node.clusterId, list);
  }

  // Bucket intra-cluster edges by cluster (cross-cluster edges do not shape
  // the local layouts).
  const localIndex = new Map<string, Map<string, number>>();
  for (const [clusterId, nodeIds] of byCluster) {
    localIndex.set(clusterId, new Map(nodeIds.map((id, i) => [id, i])));
  }
  const edgesByCluster = new Map<string, ClusterEdge[]>();
  for (const edge of graph.edges as MemoryGraphEdge[]) {
    const cluster = clusterOf.get(edge.source);
    if (!cluster || clusterOf.get(edge.target) !== cluster) continue;
    const index = localIndex.get(cluster)!;
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a === undefined || b === undefined) continue;
    const list = edgesByCluster.get(cluster) ?? [];
    list.push({ a, b, weight: edge.weight });
    edgesByCluster.set(cluster, list);
  }

  // Lay out each cluster, then circle-pack the cluster discs.
  const clusterLayouts = new Map<string, { local: Map<string, NodePosition>; radius: number }>();
  for (const [clusterId, nodeIds] of byCluster) {
    clusterLayouts.set(clusterId, layoutCluster(nodeIds, edgesByCluster.get(clusterId) ?? []));
  }
  const centers = packClusters(
    [...clusterLayouts].map(([id, layout]) => ({ id, radius: layout.radius })),
  );

  // Combine local positions with their packed cluster centres.
  for (const [clusterId, layout] of clusterLayouts) {
    const center = centers.get(clusterId) ?? { x: 0, y: 0 };
    for (const [nodeId, point] of layout.local) {
      result.set(nodeId, { x: center.x + point.x, y: center.y + point.y });
    }
  }

  // Scale the whole diagram so its larger dimension fills roughly `span`.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of result.values()) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const scale = span / extent;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const [nodeId, point] of result) {
    result.set(nodeId, {
      x: span / 2 + (point.x - cx) * scale,
      y: span / 2 + (point.y - cy) * scale,
    });
  }
  return result;
}
