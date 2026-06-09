// Persistent, app-wide execution trace.
//
// The live per-run trace (agentStore.activity) is cleared between runs and lost
// on reload. This store mirrors the same `agent:activity` stream into a capped,
// persisted ring buffer that survives across every chat AND across app restarts,
// so a model swap, a source failure, or a dropped section that happened in a
// previous run is still inspectable for debugging. It is never cleared by a
// per-run reset — only by an explicit user "Clear all". Install once at boot.

import { create } from 'zustand';
import type { AgentId } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import { platform } from '@platform/index';

export interface TraceEntry {
  id: string;
  agentId: AgentId | 'system';
  phase: string;
  detail?: string;
  ts: number; // absolute wall-clock ms, so entries are ordered across sessions
}

const MAX_ENTRIES = 2000;
const STORAGE_KEY = 'trace.log.v1';
const SAVE_DEBOUNCE_MS = 800;

interface TraceLogStore {
  entries: TraceEntry[]; // newest-first, matching agentStore.activity
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (record: Omit<TraceEntry, 'id' | 'ts'>) => void;
  clear: () => void;
}

let seq = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Writes can be high-frequency during a run, so persist on a trailing debounce
// rather than on every entry.
function scheduleSave(entries: TraceEntry[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void platform()
      .storage.set<{ entries: TraceEntry[] }>(STORAGE_KEY, { entries })
      .catch(() => {
        /* storage may be unavailable; the in-memory log still works */
      });
  }, SAVE_DEBOUNCE_MS);
}

export const useTraceLogStore = create<TraceLogStore>((set) => ({
  entries: [],
  hydrated: false,

  hydrate: async () => {
    try {
      const stored = await platform().storage.get<{ entries: TraceEntry[] }>(STORAGE_KEY);
      const entries = Array.isArray(stored?.entries) ? stored.entries.slice(0, MAX_ENTRIES) : [];
      set({ entries, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  add: (record) =>
    set((state) => {
      const entry: TraceEntry = {
        ...record,
        id: `t${++seq}`,
        ts: Date.now(),
      };
      const entries = [entry, ...state.entries].slice(0, MAX_ENTRIES);
      scheduleSave(entries);
      return { entries };
    }),

  clear: () => {
    scheduleSave([]);
    set({ entries: [] });
  },
}));

let installed = false;

/** Subscribe the persistent trace log to the activity bus. Call once at boot. */
export function installTraceLog(): void {
  if (installed) return;
  installed = true;
  // Load prior history first, then mark this session's boundary, then start
  // recording — so a restart is visible as a divider in the continuous log and
  // hydration never clobbers freshly captured entries.
  void useTraceLogStore
    .getState()
    .hydrate()
    .then(() => {
      const store = useTraceLogStore.getState();
      store.add({ agentId: 'system', phase: 'start', detail: 'app session started' });
      bus.on('agent:activity', (event) => {
        useTraceLogStore.getState().add({
          agentId: event.agentId,
          phase: event.phase,
          ...(event.detail !== undefined ? { detail: event.detail } : {}),
        });
      });
    });
}
