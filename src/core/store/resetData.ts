// One-shot "reset everything" — wipes all user data for a clean slate, then
// reloads so every store re-hydrates from the now-empty persistence (the project
// store re-seeds a fresh default project).
//
// Cleared: projects, chat history, research runs, project memory + embeddings
// (current and legacy schema), and the on-disk source cache.
// Kept: app settings/preferences (theme, Ollama host, memory toggle, privacy)
// and provider API keys — those are configuration, not data.

import { platform } from '@platform/index';

// User-data persistence keys. Keep in sync with each store's STORAGE_KEY.
const USER_DATA_KEYS = [
  'projects.v1', // projectStore
  'chatHistory.v1', // chatHistoryStore
  'research.runs.v1', // researchRunStore
  'rag.v2', // ragStore — memory + int8 vectors
  'rag.v1', // legacy pre-vector memory (discard any leftover)
  'rag.v3', // ragStore — imported-document schema
  'peerReview.v1', // peerReviewStore — reviewed papers + reviews
];

/** Wipe all saved data and reload into a clean state. */
export async function resetAllData(): Promise<void> {
  await Promise.allSettled(USER_DATA_KEYS.map((key) => platform().storage.delete(key)));
  try {
    await platform().cache.clear(); // SQLite source-response cache
  } catch {
    /* cache backend may be unavailable (browser dev) — ignore */
  }
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}
