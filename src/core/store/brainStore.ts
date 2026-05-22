// Brain lighting state. Maintains per-region glow intensities that decay
// over time. EventBus → store → R3F scene reads via useBrainStore.

import { create } from 'zustand';
import { agentById, type AgentId, type RegionId } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import type { AgentActivityEvent } from '@core/bus/events';

interface RegionState {
  base: number; // 0..1 transient glow (held + decays)
  accent: number; // 0..1 transient accent (held + decays)
  baseHoldUntil: number; // epoch ms
  accentHoldUntil: number; // epoch ms
}

interface BrainStore {
  regions: Record<RegionId, RegionState>;
  // The region currently addressed in the memory diagram, lit on the 3D brain.
  focusRegion: RegionId | null;
  setRegion: (region: RegionId, source: 'agent' | 'topic', intensity: number, ttlMs: number) => void;
  setFocusRegion: (region: RegionId | null) => void;
  tick: (deltaMs?: number) => void;
}

const initialRegion = (): RegionState => ({
  base: 0,
  accent: 0,
  baseHoldUntil: 0,
  accentHoldUntil: 0,
});

const HOLD_PROFILE = {
  agent: { minMs: 240, maxMs: 700, ttlRatio: 0.16 },
  topic: { minMs: 120, maxMs: 340, ttlRatio: 0.08 },
} as const;

const DECAY_HALF_LIFE_MS = {
  agent: 900,
  topic: 380,
} as const;

const ACTIVITY_LIGHT_PROFILE: Record<
  AgentActivityEvent['phase'],
  { intensity: number; ttlMs: number }
> = {
  start: { intensity: 0.82, ttlMs: 2200 },
  tool_call: { intensity: 0.68, ttlMs: 1600 },
  tool_result: { intensity: 0.74, ttlMs: 1700 },
  token: { intensity: 0.48, ttlMs: 900 },
  done: { intensity: 0.58, ttlMs: 1400 },
  error: { intensity: 0.42, ttlMs: 1200 },
};

function decayByHalfLife(value: number, deltaMs: number, halfLifeMs: number): number {
  if (value <= 0) return 0;
  const multiplier = Math.pow(0.5, Math.max(0, deltaMs) / halfLifeMs);
  return value * multiplier;
}

function holdMsFor(source: 'agent' | 'topic', ttlMs: number): number {
  const profile = HOLD_PROFILE[source];
  return Math.min(Math.max(ttlMs * profile.ttlRatio, profile.minMs), profile.maxMs);
}

function clampIntensity(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function activityLight(event: AgentActivityEvent): { intensity: number; ttlMs: number } {
  const fallback = ACTIVITY_LIGHT_PROFILE[event.phase];
  return {
    intensity: clampIntensity(event.light?.intensity ?? fallback.intensity),
    ttlMs: Math.max(0, event.light?.ttlMs ?? fallback.ttlMs),
  };
}

function isAgentId(agentId: AgentActivityEvent['agentId']): agentId is AgentId {
  return agentId !== 'system';
}

export function lightAgentActivity(event: AgentActivityEvent): void {
  const light = activityLight(event);
  if (isAgentId(event.agentId)) {
    bus.emit('region:light', {
      region: agentById(event.agentId).regionBinding,
      source: 'agent',
      agentId: event.agentId,
      intensity: light.intensity,
      ttlMs: light.ttlMs,
    });
  }

  bus.emit('region:light', {
    region: 'thalamus',
    source: 'agent',
    ...(isAgentId(event.agentId) ? { agentId: event.agentId } : {}),
    intensity: clampIntensity(light.intensity * 0.45),
    ttlMs: Math.min(light.ttlMs, 1400),
  });
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
  focusRegion: null,
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
  setFocusRegion: (region) => set({ focusRegion: region }),
  tick: (deltaMs = 16.7) =>
    set((state) => {
      const now = Date.now();
      const next: Record<RegionId, RegionState> = { ...state.regions };
      let changed = false;
      for (const r of BRAIN_REGIONS) {
        const cur = next[r];
        let base = cur.base;
        let accent = cur.accent;
        if (base > 0 && now > cur.baseHoldUntil) {
          base = decayByHalfLife(base, deltaMs, DECAY_HALF_LIFE_MS.agent);
        }
        if (accent > 0 && now > cur.accentHoldUntil) {
          // Topic hits should read as quick sparks during synthesis, not
          // long sticky washes that hide the active agent colour.
          accent = decayByHalfLife(accent, deltaMs, DECAY_HALF_LIFE_MS.topic);
        }
        if (base < 0.006) base = 0;
        if (accent < 0.006) accent = 0;
        if (base !== cur.base || accent !== cur.accent) {
          changed = true;
          next[r] = base === 0 && accent === 0 ? initialRegion() : { ...cur, base, accent };
        }
      }
      if (!changed) return state;
      return { regions: next };
    }),
}));

// Wire the EventBus to the store.
bus.on('agent:activity', lightAgentActivity);

bus.on('region:light', (e) => {
  useBrainStore.getState().setRegion(e.region, e.source, e.intensity, e.ttlMs);
});
