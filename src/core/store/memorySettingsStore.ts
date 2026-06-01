// Whether research runs may draw on saved project memory. When OFF, the
// rag_search tool returns nothing, so the swarm researches "from scratch" using
// only freshly fetched sources — useful for a clean, unbiased run. Saving new
// findings is unaffected; this only governs retrieval/use. Persisted locally.

import { create } from 'zustand';

const STORAGE_KEY = 'hc.memory.useEnabled.v1';

function load(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

interface MemorySettingsStore {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  toggle: () => void;
}

export const useMemorySettingsStore = create<MemorySettingsStore>((set, get) => ({
  enabled: load(),
  setEnabled: (value) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch {
      /* storage may be unavailable; the in-memory flag still works */
    }
    set({ enabled: value });
  },
  toggle: () => get().setEnabled(!get().enabled),
}));
