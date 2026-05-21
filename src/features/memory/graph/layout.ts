// Force-directed layout for the memory graph — a small deterministic
// Fruchterman-Reingold simulation with cluster-aware seeding and gravity.
// It keeps findings from the same topic near each other while pushing
// different clusters apart, so the diagram does not collapse into one flat
// node soup.

import type { MemoryGraph } from './memoryGraph';

export interface NodePosition {
  x: number;
  y: number;
}

const ITERATIONS = 320;

function nodeLayoutRadius(degree: number): number {
  return 13 + Math.sqrt(degree) * 4;
}

function clusterCenters(graph: MemoryGraph, span: number): Map<string, NodePosition> {
  const centre = span / 2;
  const clusters = graph.clusters.length > 0
    ? graph.clusters
    : [{ id: 'default', label: 'Memory', nodeIds: graph.nodes.map((node) => node.id), terms: [] }];
  const radius = clusters.length <= 1 ? 0 : span * 0.31;
  const map = new Map<string, NodePosition>();
  clusters.forEach((cluster, index) => {
    const angle = -Math.PI / 2 + (index / clusters.length) * Math.PI * 2;
    map.set(cluster.id, {
      x: centre + Math.cos(angle) * radius,
      y: centre + Math.sin(angle) * radius,
    });
  });
  return map;
}

/** Deterministic clustered seed so the layout never jitters between renders. */
function seedPositions(graph: MemoryGraph, span: number, centers: Map<string, NodePosition>): NodePosition[] {
  const centre = span / 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const byCluster = new Map<string, number[]>();
  graph.nodes.forEach((node, index) => {
    const key = node.clusterId || 'default';
    const list = byCluster.get(key) ?? [];
    list.push(index);
    byCluster.set(key, list);
  });

  const out = graph.nodes.map(() => ({ x: centre, y: centre }));
  for (const [clusterId, indices] of byCluster) {
    const anchor = centers.get(clusterId) ?? { x: centre, y: centre };
    const radius = Math.min(span * 0.1, 42 + Math.sqrt(indices.length) * 28);
    indices.forEach((nodeIndex, localIndex) => {
      const t = indices.length <= 1 ? 0 : (localIndex + 1) / indices.length;
      const r = radius * Math.sqrt(t);
      const angle = localIndex * goldenAngle;
      out[nodeIndex] = { x: anchor.x + r * Math.cos(angle), y: anchor.y + r * Math.sin(angle) };
    });
  }
  return out;
}

/**
 * Lay the graph out inside a virtual `span × span` square. Returns a map of
 * node id → position. The caller fits the result into its viewport with a
 * pan/zoom transform, so layout never has to rerun on container resize.
 */
export function layoutMemoryGraph(graph: MemoryGraph, span: number): Map<string, NodePosition> {
  const count = graph.nodes.length;
  const result = new Map<string, NodePosition>();
  if (count === 0) return result;
  if (count === 1) {
    result.set(graph.nodes[0]!.id, { x: span / 2, y: span / 2 });
    return result;
  }

  const centers = clusterCenters(graph, span);
  const pos = seedPositions(graph, span, centers);
  const index = new Map<string, number>();
  graph.nodes.forEach((node, i) => index.set(node.id, i));

  const radii = graph.nodes.map((node) => nodeLayoutRadius(node.degree));
  const ideal = Math.sqrt((span * span) / count) * 0.72; // ideal edge length
  const centre = span / 2;
  let temperature = span * 0.18;
  const cooling = temperature / (ITERATIONS + 1);
  const disp: NodePosition[] = pos.map(() => ({ x: 0, y: 0 }));

  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    for (let i = 0; i < count; i += 1) {
      disp[i]!.x = 0;
      disp[i]!.y = 0;
    }

    // Repulsion between every pair of nodes.
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        let dx = pos[i]!.x - pos[j]!.x;
        let dy = pos[i]!.y - pos[j]!.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          // Coincident nodes — nudge deterministically so they separate.
          dx = (i - j) * 0.01 + 0.01;
          dy = 0.013;
          dist = Math.hypot(dx, dy);
        }
        const sameCluster = graph.nodes[i]!.clusterId === graph.nodes[j]!.clusterId;
        const minDist = radii[i]! + radii[j]! + (sameCluster ? 18 : 34);
        const overlapForce = dist < minDist ? (minDist - dist) * 1.7 : 0;
        const force = ((ideal * ideal) / dist) * (sameCluster ? 0.82 : 1.32) + overlapForce;
        const ux = dx / dist;
        const uy = dy / dist;
        disp[i]!.x += ux * force;
        disp[i]!.y += uy * force;
        disp[j]!.x -= ux * force;
        disp[j]!.y -= uy * force;
      }
    }

    // Attraction along edges — a stronger link pulls harder.
    for (const edge of graph.edges) {
      const a = index.get(edge.source);
      const b = index.get(edge.target);
      if (a === undefined || b === undefined) continue;
      const dx = pos[a]!.x - pos[b]!.x;
      const dy = pos[a]!.y - pos[b]!.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const sameCluster = graph.nodes[a]!.clusterId === graph.nodes[b]!.clusterId;
      const force = ((dist * dist) / ideal) * (sameCluster ? 0.34 + edge.weight : 0.22 + edge.weight * 0.6);
      const ux = dx / dist;
      const uy = dy / dist;
      disp[a]!.x -= ux * force;
      disp[a]!.y -= uy * force;
      disp[b]!.x += ux * force;
      disp[b]!.y += uy * force;
    }

    // Topic gravity keeps clusters coherent; gentle global gravity keeps
    // disconnected clusters from drifting off-canvas.
    for (let i = 0; i < count; i += 1) {
      const cluster = centers.get(graph.nodes[i]!.clusterId) ?? { x: centre, y: centre };
      const clusterPull = graph.nodes[i]!.degree === 0 ? 0.02 : 0.012;
      disp[i]!.x += (cluster.x - pos[i]!.x) * clusterPull;
      disp[i]!.y += (cluster.y - pos[i]!.y) * clusterPull;
      disp[i]!.x += (centre - pos[i]!.x) * 0.004;
      disp[i]!.y += (centre - pos[i]!.y) * 0.004;
    }

    // Apply displacement, capped by the cooling temperature.
    for (let i = 0; i < count; i += 1) {
      const magnitude = Math.max(Math.hypot(disp[i]!.x, disp[i]!.y), 0.01);
      const step = Math.min(magnitude, temperature);
      pos[i]!.x += (disp[i]!.x / magnitude) * step;
      pos[i]!.y += (disp[i]!.y / magnitude) * step;
      pos[i]!.x = Math.min(Math.max(pos[i]!.x, 32), span - 32);
      pos[i]!.y = Math.min(Math.max(pos[i]!.y, 32), span - 32);
    }
    temperature = Math.max(temperature - cooling, 1);
  }

  graph.nodes.forEach((node, i) => result.set(node.id, { x: pos[i]!.x, y: pos[i]!.y }));
  return result;
}
