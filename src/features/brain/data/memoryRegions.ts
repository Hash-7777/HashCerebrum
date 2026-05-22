// Maps a saved memory chunk to an anatomical brain region, so clicking a
// finding in the memory diagram lights the corresponding region on the 3D brain.

import type { RegionId } from '@config/agents';
import type { RagChunk } from '@core/store/ragStore';
import { SOURCE_DEFS } from './sources';

// Synthesized answers are executive output — they map to the frontal region.
const ANSWER_REGION: RegionId = 'frontal';

const REGION_BY_SOURCE = new Map<string, RegionId>(SOURCE_DEFS.map((def) => [def.id, def.region]));

/** The anatomical region a single saved finding lights up on the 3D brain. */
export function regionForChunk(chunk: RagChunk): RegionId {
  if (chunk.kind === 'answer') return ANSWER_REGION;
  return REGION_BY_SOURCE.get(chunk.source) ?? ANSWER_REGION;
}
