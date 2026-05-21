// Keeps the 3D brain's steady glow bound to the active project's memory.
// Whenever the project's saved findings change, the per-region memory weights
// are recomputed and pushed into the brain store, so the model is a live
// physical map of the project's knowledge (Phase 43).

import { useEffect } from 'react';
import { useBrainStore } from '@core/store/brainStore';
import { useProjectStore } from '@core/store/projectStore';
import { useRagStore } from '@core/store/ragStore';
import { memoryRegionWeights } from './data/memoryRegions';

export function useMemoryBrainBinding(): void {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const chunks = useRagStore((state) => state.chunks);

  useEffect(() => {
    const projectChunks = activeProjectId
      ? chunks.filter((chunk) => chunk.projectId === activeProjectId)
      : [];
    useBrainStore.getState().setMemoryWeights(memoryRegionWeights(projectChunks));
  }, [activeProjectId, chunks]);
}
