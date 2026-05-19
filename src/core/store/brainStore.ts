// Brain lighting state. Maintains per-region glow intensities that decay
// over time. EventBus → store → R3F scene reads via useBrainStore.

import { create } from 'zustand';
import type { RegionId } from '@config/agents';
import { bus } from '@core/bus/EventBus';

interface RegionState {
  base: number; // 0..1 from agent binding
  accent: number; // 0..1 from topic detection
  decayUntil: number; // epoch ms
}

interface BrainStore {
  regions: Record<RegionId, RegionState>;
  setRegion: (region: RegionId, source: 'agent' | 'topic', intensity: number, ttlMs: number) => void;
  tick: () => void;
}

const initialRegion = (): RegionState => ({ base: 0, accent: 0, decayUntil: 0 });

const REGIONS: RegionId[] = [
  'frontal',
  'parietal',
  'temporal',
  'occipital',
  'cerebellum',
  'brainstem',
  'hippocampus',
  'amygdala',
  'thalamus',
  'basal_ganglia',
];

const initialState = (): Record<RegionId, RegionState> =>
  Object.fromEntries(REGIONS.map((r) => [r, initialRegion()])) as Record<RegionId, RegionState>;

export const useBrainStore = create<BrainStore>((set) => ({
  regions: initialState(),
  setRegion: (region, source, intensity, ttlMs) =>
    set((state) => ({
      regions: {
        ...state.regions,
        [region]: {
          ...state.regions[region],
          [source === 'agent' ? 'base' : 'accent']: intensity,
          decayUntil: Date.now() + ttlMs,
        },
      },
    })),
  tick: () =>
    set((state) => {
      const now = Date.now();
      const next: Record<RegionId, RegionState> = { ...state.regions };
      for (const r of REGIONS) {
        const cur = next[r];
        if (cur.decayUntil > 0 && now > cur.decayUntil) {
          next[r] = { base: cur.base * 0.92, accent: cur.accent * 0.92, decayUntil: cur.decayUntil };
          if (next[r].base < 0.01 && next[r].accent < 0.01) {
            next[r] = initialRegion();
          }
        }
      }
      return { regions: next };
    }),
}));

// Wire the EventBus to the store.
bus.on('region:light', (e) => {
  useBrainStore.getState().setRegion(e.region, e.source, e.intensity, e.ttlMs);
});
