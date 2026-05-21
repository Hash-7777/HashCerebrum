// Force-directed layout for the memory graph — a small Fruchterman-Reingold
// simulation run to a fixed iteration count. Pure and deterministic (a
// golden-angle spiral seed, no Math.random), so the same graph always lays
// out the same way and the function stays unit-testable.

import type { MemoryGraph } from './memoryGraph';

export interface NodePosition {
  x: number;
  y: number;
}

const ITERATIONS = 320;

/** Deterministic spiral seed so the layout never jitters between renders. */
function seedPositions(count: number, span: number): NodePosition[] {
  const centre = span / 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const radius = span * 0.42;
  const out: NodePosition[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count <= 1 ? 0 : i / (count - 1);
    const r = radius * Math.sqrt(t);
    const angle = i * goldenAngle;
    out.push({ x: centre + r * Math.cos(angle), y: centre + r * Math.sin(angle) });
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

  const pos = seedPositions(count, span);
  const index = new Map<string, number>();
  graph.nodes.forEach((node, i) => index.set(node.id, i));

  const ideal = Math.sqrt((span * span) / count) * 0.8; // ideal edge length
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
    for (const edge of graph.edges) {
      const a = index.get(edge.source);
      const b = index.get(edge.target);
      if (a === undefined || b === undefined) continue;
      const dx = pos[a]!.x - pos[b]!.x;
      const dy = pos[a]!.y - pos[b]!.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const force = ((dist * dist) / ideal) * (0.4 + edge.weight);
      const ux = dx / dist;
      const uy = dy / dist;
      disp[a]!.x -= ux * force;
      disp[a]!.y -= uy * force;
      disp[b]!.x += ux * force;
      disp[b]!.y += uy * force;
    }

    // Gentle gravity keeps disconnected nodes from drifting off-canvas.
    for (let i = 0; i < count; i += 1) {
      disp[i]!.x += (centre - pos[i]!.x) * 0.012;
      disp[i]!.y += (centre - pos[i]!.y) * 0.012;
    }

    // Apply displacement, capped by the cooling temperature.
    for (let i = 0; i < count; i += 1) {
      const magnitude = Math.max(Math.hypot(disp[i]!.x, disp[i]!.y), 0.01);
      const step = Math.min(magnitude, temperature);
      pos[i]!.x += (disp[i]!.x / magnitude) * step;
      pos[i]!.y += (disp[i]!.y / magnitude) * step;
    }
    temperature = Math.max(temperature - cooling, 1);
  }

  graph.nodes.forEach((node, i) => result.set(node.id, { x: pos[i]!.x, y: pos[i]!.y }));
  return result;
}
