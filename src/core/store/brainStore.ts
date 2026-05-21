// Brain lighting state. Maintains per-region glow intensities that decay
// over time. EventBus → store → R3F scene reads via useBrainStore.

import { create } from 'zustand';
import type { RegionId } from '@config/agents';
import { bus } from '@core/bus/EventBus';

interface RegionState {
  base: number; // 0..1 from agent binding
  accent: number; // 0..1 from topic detection
  baseHoldUntil: number; // epoch ms
  accentHoldUntil: number; // epoch ms
}

interface BrainStore {
  regions: Record<RegionId, RegionState>;
  setRegion: (region: RegionId, source: 'agent' | 'topic', intensity: number, ttlMs: number) => void;
  tick: (decayFactor?: number) => void;
}

const initialRegion = (): RegionState => ({ base: 0, accent: 0, baseHoldUntil: 0, accentHoldUntil: 0 });

const HOLD_PROFILE = {
  agent: { minMs: 180, maxMs: 520, ttlRatio: 0.12 },
  topic: { minMs: 90, maxMs: 260, ttlRatio: 0.06 },
} as const;

function holdMsFor(source: 'agent' | 'topic', ttlMs: number): number {
  const profile = HOLD_PROFILE[source];
  return Math.min(Math.max(ttlMs * profile.ttlRatio, profile.minMs), profile.maxMs);
}

export const BRAIN_REGIONS: RegionId[] = [
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

export const createInitialBrainRegions = (): Record<RegionId, RegionState> =>
  Object.fromEntries(BRAIN_REGIONS.map((r) => [r, initialRegion()])) as Record<RegionId, RegionState>;

export const useBrainStore = create<BrainStore>((set) => ({
  regions: createInitialBrainRegions(),
  setRegion: (region, source, intensity, ttlMs) =>
    set((state) => {
      const now = Date.now();
      const current = state.regions[region];
      const channel = source === 'agent' ? 'base' : 'accent';
      const holdChannel = source === 'agent' ? 'baseHoldUntil' : 'accentHoldUntil';
      return {
        regions: {
          ...state.regions,
          [region]: {
            ...current,
            [channel]: Math.min(1, Math.max(current[channel], intensity)),
            [holdChannel]: now + holdMsFor(source, ttlMs),
          },
        },
      };
    }),
  tick: (decayFactor = 0.8) =>
    set((state) => {
      const now = Date.now();
      const next: Record<RegionId, RegionState> = { ...state.regions };
      let changed = false;
      for (const r of BRAIN_REGIONS) {
        const cur = next[r];
        let base = cur.base;
        let accent = cur.accent;
        if (base > 0 && now > cur.baseHoldUntil) {
          base *= decayFactor;
        }
        if (accent > 0 && now > cur.accentHoldUntil) {
          // Topic hits should read as quick sparks during synthesis, not
          // long sticky washes that hide the active agent colour.
          accent *= Math.max(0.35, decayFactor * 0.78);
        }
        if (base < 0.008) base = 0;
        if (accent < 0.008) accent = 0;
        if (base !== cur.base || accent !== cur.accent) {
          changed = true;
          if (base === 0 && accent === 0) {
            next[r] = initialRegion();
          } else {
            next[r] = { ...cur, base, accent };
          }
        }
      }
      if (!changed) return state;
      return { regions: next };
    }),
}));

// Wire the EventBus to the store.
bus.on('region:light', (e) => {
  useBrainStore.getState().setRegion(e.region, e.source, e.intensity, e.ttlMs);
});
