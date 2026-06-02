// Brain composer toggles, persisted locally.
//   - mini: a lighter research pipeline — fewer specialists, a reduced section
//     set, smaller token budgets, and NO rate-limit pausing — so free models
//     and small Ollama models produce a usable lighter paper without being
//     given a hard time.
//   - drugFocus: route the question to a single drug-interaction specialist
//     that writes a focused, professional interaction report from trusted
//     interaction sources (its findings still save to the shared memory, so
//     Brain benefits from them later).

import { create } from 'zustand';

const MINI_KEY = 'hc.brain.mini.v1';
const DRUG_FOCUS_KEY = 'hc.brain.drugFocus.v1';

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
  drugFocus: boolean;
  setDrugFocus: (value: boolean) => void;
  toggleDrugFocus: () => void;
}

export const useBrainModesStore = create<BrainModesStore>((set, get) => ({
  mini: loadBool(MINI_KEY, false),
  setMini: (value) => {
    saveBool(MINI_KEY, value);
    set({ mini: value });
  },
  toggleMini: () => get().setMini(!get().mini),
  drugFocus: loadBool(DRUG_FOCUS_KEY, false),
  setDrugFocus: (value) => {
    saveBool(DRUG_FOCUS_KEY, value);
    set({ drugFocus: value });
  },
  toggleDrugFocus: () => get().setDrugFocus(!get().drugFocus),
}));
