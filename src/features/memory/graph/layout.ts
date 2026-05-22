// Obsidian-style topic-constellation layout for the memory graph.
//
// The old layout warped every node into a brain silhouette. That looked novel,
// but large research runs collapsed into dense piles of identical dots. This
// layout makes the information legible first: each topic gets a deterministic
// centre, nodes orbit that centre in readable rings, and a short force pass
// separates nearby dots while keeping clusters coherent.

import type { MemoryGraph } from './memoryGraph';

export interface NodePosition {
  x: number;
  y: number;
}

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const RELAX_ITERATIONS = 120;

function clusterRadius(size: number): number {
  return Math.min(360, Math.max(82, 48 + Math.sqrt(size) * 24 + size * 0.45));
}

function nodeRadius(degree: number): number {
  return Math.min(11, 4 + Math.sqrt(Math.max(0, degree)) * 1.55);
}

function placeClusterCenters(graph: MemoryGraph, span: number): Map<string, NodePosition> {
  const cx = span / 2;
  const cy = span / 2;
  const clusters = [...graph.clusters].sort((a, b) => b.nodeIds.length - a.nodeIds.length || a.label.localeCompare(b.label));
  const centers = new Map<string, NodePosition>();
  const placed: { x: number; y: number; r: number }[] = [];
  const baseStep = Math.max(190, Math.min(340, span / Math.max(4, Math.sqrt(clusters.length) * 2.4)));

  clusters.forEach((cluster, index) => {
    const r = clusterRadius(cluster.nodeIds.length);
    if (index === 0) {
      centers.set(cluster.id, { x: cx, y: cy });
      placed.push({ x: cx, y: cy, r });
      return;
    }

    let chosen: NodePosition | null = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const ring = Math.max(1, Math.floor(Math.sqrt(attempt + index)));
      const angle = (attempt + index * 11) * GOLDEN_ANGLE;
      const distance = baseStep * Math.sqrt(ring) + r * 0.38;
      const x = cx + Math.cos(angle) * distance;
      const y = cy + Math.sin(angle) * distance;
      const collides = placed.some((other) => Math.hypot(x - other.x, y - other.y) < r + other.r + 54);
      if (!collides) {
        chosen = { x, y };
        break;
      }
    }

    const fallbackAngle = index * GOLDEN_ANGLE;
    const fallbackDistance = baseStep * Math.sqrt(index + 1);
    const point = chosen ?? {
      x: cx + Math.cos(fallbackAngle) * fallbackDistance,
      y: cy + Math.sin(fallbackAngle) * fallbackDistance,
    };
    centers.set(cluster.id, point);
    placed.push({ ...point, r });
  });

  return centers;
}

export function graphBounds(positions: Map<string, NodePosition>, fallbackSpan = 1000): GraphBounds {
  if (positions.size === 0) {
    return { minX: 0, minY: 0, maxX: fallbackSpan, maxY: fallbackSpan };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of positions.values()) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const pad = 150;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function layoutMemoryGraph(graph: MemoryGraph, span: number): Map<string, NodePosition> {
  const result = new Map<string, NodePosition>();
  const n = graph.nodes.length;
  if (n === 0) return result;

  const centers = placeClusterCenters(graph, span);
  const nodesByCluster = new Map<string, typeof graph.nodes>();
  graph.nodes.forEach((node) => {
    const list = nodesByCluster.get(node.clusterId) ?? [];
    list.push(node);
    nodesByCluster.set(node.clusterId, list);
  });

  for (const cluster of graph.clusters) {
    const center = centers.get(cluster.id) ?? { x: span / 2, y: span / 2 };
    const clusterNodes = [...(nodesByCluster.get(cluster.id) ?? [])].sort((a, b) => {
      if (a.chunk.kind !== b.chunk.kind) return a.chunk.kind === 'answer' ? -1 : 1;
      return b.degree - a.degree || b.chunk.createdAt.localeCompare(a.chunk.createdAt);
    });
    const radius = clusterRadius(clusterNodes.length);
    const maxOrbit = radius * 0.82;

    clusterNodes.forEach((node, index) => {
      if (clusterNodes.length === 1) {
        result.set(node.id, { ...center });
        return;
      }
      const isCentralAnswer = index === 0 && node.chunk.kind === 'answer';
      const orbitIndex = isCentralAnswer ? 0 : index + (clusterNodes[0]?.chunk.kind === 'answer' ? 0 : 1);
      const t = orbitIndex / Math.max(1, clusterNodes.length - 1);
      const distance = isCentralAnswer ? 0 : 24 + Math.sqrt(t) * maxOrbit;
      const angle = index * GOLDEN_ANGLE + cluster.label.length * 0.031;
      result.set(node.id, {
        x: center.x + Math.cos(angle) * distance,
        y: center.y + Math.sin(angle) * distance,
      });
    });
  }

  const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
  const pos = graph.nodes.map((node) => result.get(node.id) ?? { x: span / 2, y: span / 2 });
  const disp = pos.map(() => ({ x: 0, y: 0 }));
  const edges = graph.edges
    .map((edge) => ({ a: index.get(edge.source), b: index.get(edge.target), weight: edge.weight }))
    .filter((edge): edge is { a: number; b: number; weight: number } => edge.a !== undefined && edge.b !== undefined);

  for (let iter = 0; iter < RELAX_ITERATIONS; iter += 1) {
    for (const d of disp) {
      d.x = 0;
      d.y = 0;
    }

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const sameCluster = graph.nodes[i]!.clusterId === graph.nodes[j]!.clusterId;
        let dx = pos[i]!.x - pos[j]!.x;
        let dy = pos[i]!.y - pos[j]!.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          dx = (i - j) * 0.04 + 0.03;
          dy = 0.025;
          dist = Math.hypot(dx, dy);
        }
        const minDist = nodeRadius(graph.nodes[i]!.degree) + nodeRadius(graph.nodes[j]!.degree) + (sameCluster ? 10 : 34);
        if (dist >= minDist * 1.6) continue;
        const force = ((minDist * 1.6 - dist) / (minDist * 1.6)) * (sameCluster ? 1.6 : 2.6);
        const ux = dx / dist;
        const uy = dy / dist;
        disp[i]!.x += ux * force;
        disp[i]!.y += uy * force;
        disp[j]!.x -= ux * force;
        disp[j]!.y -= uy * force;
      }
    }

    for (const edge of edges) {
      const source = graph.nodes[edge.a]!;
      const target = graph.nodes[edge.b]!;
      const sameCluster = source.clusterId === target.clusterId;
      const desired = sameCluster ? 118 + (1 - edge.weight) * 64 : 210 + (1 - edge.weight) * 110;
      const dx = pos[edge.b]!.x - pos[edge.a]!.x;
      const dy = pos[edge.b]!.y - pos[edge.a]!.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const force = (dist - desired) * (sameCluster ? 0.00155 : 0.0012) * (0.5 + edge.weight);
      const ux = dx / dist;
      const uy = dy / dist;
      disp[edge.a]!.x += ux * force;
      disp[edge.a]!.y += uy * force;
      disp[edge.b]!.x -= ux * force;
      disp[edge.b]!.y -= uy * force;
    }

    for (let i = 0; i < n; i += 1) {
      const node = graph.nodes[i]!;
      const center = centers.get(node.clusterId) ?? { x: span / 2, y: span / 2 };
      disp[i]!.x += (center.x - pos[i]!.x) * 0.005;
      disp[i]!.y += (center.y - pos[i]!.y) * 0.005;
      const step = Math.min(7, Math.hypot(disp[i]!.x, disp[i]!.y));
      const magnitude = Math.max(Math.hypot(disp[i]!.x, disp[i]!.y), 0.01);
      pos[i]!.x += (disp[i]!.x / magnitude) * step;
      pos[i]!.y += (disp[i]!.y / magnitude) * step;
    }
  }

  graph.nodes.forEach((node, i) => {
    result.set(node.id, pos[i]!);
  });
  return result;
}
