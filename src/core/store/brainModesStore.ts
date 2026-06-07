// Brain composer toggles, persisted locally.
//   - mini: a lighter research pipeline — fewer specialists, a reduced section
//     set, smaller token budgets, and NO rate-limit pausing — so free models
//     and small Ollama models produce a usable lighter paper without being
//     given a hard time.
//   - outlineFirst: propose the paper's section outline first (deterministic, no
//     tokens) so the user can review the structure and approve before a full
//     drafting run is spent.
// (Drug-Interactions is its own mode/tab, not a composer toggle.)

import { create } from 'zustand';

const MINI_KEY = 'hc.brain.mini.v1';
const OUTLINE_KEY = 'hc.brain.outlineFirst.v1';
const LITE_KEY = 'hc.brain.lite.v1';

// Lite mode (lightweight 2D, no WebGL): 'auto' defers to device detection,
// 'on'/'off' are explicit user overrides.
export type LitePref = 'auto' | 'on' | 'off';

function loadLite(): LitePref {
  try {
    const v = window.localStorage.getItem(LITE_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === 'true';
  } catch {
    return fallback;
  }
}

function saveBool(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    /* storage may be unavailable; the in-memory flag still works */
  }
}

interface BrainModesStore {
  mini: boolean;
  setMini: (value: boolean) => void;
  toggleMini: () => void;
  outlineFirst: boolean;
  setOutlineFirst: (value: boolean) => void;
  toggleOutlineFirst: () => void;
  lite: LitePref;
  setLite: (value: LitePref) => void;
}

export const useBrainModesStore = create<BrainModesStore>((set, get) => ({
  mini: loadBool(MINI_KEY, false),
  setMini: (value) => {
    saveBool(MINI_KEY, value);
    set({ mini: value });
  },
  toggleMini: () => get().setMini(!get().mini),
  outlineFirst: loadBool(OUTLINE_KEY, false),
  setOutlineFirst: (value) => {
    saveBool(OUTLINE_KEY, value);
    set({ outlineFirst: value });
  },
  toggleOutlineFirst: () => get().setOutlineFirst(!get().outlineFirst),
  lite: loadLite(),
  setLite: (value) => {
    try {
      window.localStorage.setItem(LITE_KEY, value);
    } catch {
      /* storage may be unavailable; the in-memory flag still works */
    }
    set({ lite: value });
  },
}));
