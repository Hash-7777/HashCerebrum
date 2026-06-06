import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PromptVersionEntry {
  hash: string;
  template: string;
  role: 'system' | 'user';
  registeredAt: string;
}

interface PromptVersionState {
  versions: PromptVersionEntry[];
  addVersion: (entry: PromptVersionEntry) => void;
  getVersion: (hash: string) => PromptVersionEntry | undefined;
}

export const usePromptVersionStore = create<PromptVersionState>()(
  persist(
    (set, get) => ({
      versions: [],
      addVersion: (entry) =>
        set((state) => {
          if (state.versions.some((v) => v.hash === entry.hash)) return state;
          return { versions: [...state.versions, entry] };
        }),
      getVersion: (hash) => get().versions.find((v) => v.hash === hash),
    }),
    {
      name: 'hc-prompt-versions',
      version: 1,
    },
  ),
);
