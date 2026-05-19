import { useBrainStore } from '@core/store/brainStore';
import { REGIONS, type RegionMeta } from './data/regions';

export interface LitRegion extends RegionMeta {
  intensity: number;
}

export function useLitRegions(): LitRegion[] {
  const state = useBrainStore((store) => store.regions);

  return REGIONS.map((region) => {
    const regionState = state[region.id];
    const intensity = Math.min(1, regionState.base + regionState.accent * 0.6);
    return { ...region, intensity };
  });
}
