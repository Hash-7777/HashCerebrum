// Maps a project's saved memory onto anatomical brain regions, so the 3D
// brain in Brain mode becomes a physical map of what the project has learned
// rather than a readout of agent activity (Phase 43).

import type { RegionId } from '@config/agents';
import type { RagChunk } from '@core/store/ragStore';
import { SOURCE_DEFS } from './sources';

// Synthesized answers are executive output — they map to the frontal region.
const ANSWER_REGION: RegionId = 'frontal';

const REGION_BY_SOURCE = new Map<string, RegionId>(SOURCE_DEFS.map((def) => [def.id, def.region]));

/** The anatomical region a single saved finding lights up. */
export function regionForChunk(chunk: RagChunk): RegionId {
  if (chunk.kind === 'answer') return ANSWER_REGION;
  return REGION_BY_SOURCE.get(chunk.source) ?? ANSWER_REGION;
}

/**
 * Per-region memory weight (0..1) for a set of project chunks: how much of the
 * saved memory maps to each region, normalized to the busiest region. This is
 * the steady glow of the 3D brain — a physical picture of the project's
 * knowledge that fills in as more research is saved. A square root keeps a
 * single dominant region from washing the rest of the brain out.
 */
export function memoryRegionWeights(chunks: RagChunk[]): Partial<Record<RegionId, number>> {
  const counts = new Map<RegionId, number>();
  for (const chunk of chunks) {
    const region = regionForChunk(chunk);
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  const weights: Partial<Record<RegionId, number>> = {};
  for (const [region, count] of counts) {
    weights[region] = Math.sqrt(count / max);
  }
  return weights;
}
