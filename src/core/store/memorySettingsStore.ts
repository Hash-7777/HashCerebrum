// Whether research runs may draw on saved project memory. When OFF, the
// rag_search tool returns nothing, so the swarm researches "from scratch" using
// only freshly fetched sources — useful for a clean, unbiased run. Saving new
// findings is unaffected; this only governs retrieval/use. Persisted locally.

import { create } from 'zustand';

const STORAGE_KEY = 'hc.memory.useEnabled.v1';
// Whether imported PDF-library passages may be cited by the Brain. Separate from
// the memory toggle so the user can keep using saved findings while excluding
// (or including) their own imported papers. Defaults ON.
const LIBRARY_KEY = 'hc.memory.useLibrary.v1';

function load(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== 'false';
  } catch {
    return true;
  }
}

function save(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    /* storage may be unavailable; the in-memory flag still works */
  }
}

interface MemorySettingsStore {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  toggle: () => void;
  libraryEnabled: boolean;
  setLibraryEnabled: (value: boolean) => void;
  toggleLibrary: () => void;
}

export const useMemorySettingsStore = create<MemorySettingsStore>((set, get) => ({
  enabled: load(STORAGE_KEY),
  setEnabled: (value) => {
    save(STORAGE_KEY, value);
    set({ enabled: value });
  },
  toggle: () => get().setEnabled(!get().enabled),
  libraryEnabled: load(LIBRARY_KEY),
  setLibraryEnabled: (value) => {
    save(LIBRARY_KEY, value);
    set({ libraryEnabled: value });
  },
  toggleLibrary: () => get().setLibraryEnabled(!get().libraryEnabled),
}));
