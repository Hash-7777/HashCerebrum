// Maps a saved memory chunk to an anatomical brain region, so clicking a
// finding in the memory diagram lights the corresponding region on the 3D brain.
//
// Shared rather than a Brain-feature internal: the Memory graph reads it to
// light a region on hover, which previously meant Memory imported across a
// feature boundary into Brain. The mapping itself lives in config, so this
// module depends on no feature at all.

import type { RegionId } from '@config/agents';
import { ANSWER_REGION, regionForSource } from '@config/sourceRegions';
import type { RagChunk } from '@core/store/ragStore';

/** The anatomical region a single saved finding lights up on the 3D brain. */
export function regionForChunk(chunk: RagChunk): RegionId {
  if (chunk.kind === 'answer') return ANSWER_REGION;
  return regionForSource(chunk.source);
}
