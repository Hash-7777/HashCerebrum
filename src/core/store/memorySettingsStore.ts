// Whether research runs may draw on saved project memory. When OFF, the
// rag_search tool returns nothing, so the swarm researches "from scratch" using
// only freshly fetched sources — useful for a clean, unbiased run. Saving new
// findings is unaffected; this only governs retrieval/use. Persisted locally.

import { create } from 'zustand';

const STORAGE_KEY = 'hc.memory.useEnabled.v1';
// Whether imported PDF-library passages may be cited by the Brain. Separate from
// the memory toggle so the user can keep using saved findings while excluding
// (or including) their own imported papers. Defaults OFF.
const LIBRARY_KEY = 'hc.memory.useLibrary.v1';
// Whether Smart RAG (agentic query planning, coverage assessment, claim
// extraction, conflict detection, citation traversal) is active. Defaults ON.
const SMART_RAG_KEY = 'hc.memory.smartRagEnabled.v1';
// Whether the cross-encoder reranker refines the top retrieved passages. Defaults
// ON, but it only does anything when the reranker model is vendored — otherwise it
// is a silent no-op, so this toggle is harmless either way.
const RERANK_KEY = 'hc.memory.rerankEnabled.v1';
// Whether the top open-access records are enriched with their most relevant
// full-text passage (instead of only the abstract). Defaults ON; bounded and
// fail-safe — any record without open-access full text just keeps its abstract.
const FULLTEXT_KEY = 'hc.memory.fullTextEnabled.v1';

function load(key: string, defaultValue = true): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw !== 'false';
  } catch {
    return defaultValue;
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
  smartRagEnabled: boolean;
  setSmartRagEnabled: (value: boolean) => void;
  toggleSmartRag: () => void;
  rerankEnabled: boolean;
  setRerankEnabled: (value: boolean) => void;
  toggleRerank: () => void;
  fullTextEnabled: boolean;
  setFullTextEnabled: (value: boolean) => void;
  toggleFullText: () => void;
}

export const useMemorySettingsStore = create<MemorySettingsStore>((set, get) => ({
  enabled: load(STORAGE_KEY),
  setEnabled: (value) => {
    save(STORAGE_KEY, value);
    set({ enabled: value });
  },
  toggle: () => get().setEnabled(!get().enabled),
  libraryEnabled: load(LIBRARY_KEY, false),
  setLibraryEnabled: (value) => {
    save(LIBRARY_KEY, value);
    set({ libraryEnabled: value });
  },
  toggleLibrary: () => get().setLibraryEnabled(!get().libraryEnabled),
  smartRagEnabled: load(SMART_RAG_KEY),
  setSmartRagEnabled: (value) => {
    save(SMART_RAG_KEY, value);
    set({ smartRagEnabled: value });
  },
  toggleSmartRag: () => get().setSmartRagEnabled(!get().smartRagEnabled),
  rerankEnabled: load(RERANK_KEY),
  setRerankEnabled: (value) => {
    save(RERANK_KEY, value);
    set({ rerankEnabled: value });
  },
  toggleRerank: () => get().setRerankEnabled(!get().rerankEnabled),
  fullTextEnabled: load(FULLTEXT_KEY),
  setFullTextEnabled: (value) => {
    save(FULLTEXT_KEY, value);
    set({ fullTextEnabled: value });
  },
  toggleFullText: () => get().setFullTextEnabled(!get().fullTextEnabled),
}));
