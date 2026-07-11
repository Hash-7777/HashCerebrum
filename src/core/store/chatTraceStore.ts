// Per-chat execution trace.
//
// Each chat keeps its own trace of the research run(s) it produced — boss
// routing, specialist tool calls, source counts, failures — plus a divider for
// every prompt the user sent. Unlike the live per-run agentStore (which is a
// single global buffer wiped between runs), this trace is:
//
//   • chat-specific — stored under the chat id, shown only for the open chat,
//     and dropped when that chat is deleted;
//   • persistent across a normal app close/relaunch (saved through platform
//     storage), so reopening a chat still shows how its answer was produced;
//   • reset on a rebuild — the persisted blob is stamped with the build id, so a
//     freshly built bundle starts every trace clean instead of carrying stale
//     lines from a previous build.
//
// Live runs append here through the `agent:activity` bus, exactly like the live
// agentStore, so the panel updates in real time.

import { create } from 'zustand';
import type { AgentId } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import { platform } from '@platform/index';
import { useChatHistoryStore } from './chatHistoryStore';

// Injected by Vite at build time (see vite.config.ts). It changes on every
// build, so a rebuilt app no longer matches the persisted trace and starts
// fresh. Falls back to a constant when the define is absent (e.g. unit tests).
const BUILD_ID = typeof __HC_BUILD_ID__ === 'string' ? __HC_BUILD_ID__ : 'dev';

export interface ChatTraceEntry {
  id: string;
  agentId: AgentId | 'system';
  phase: string;
  detail?: string;
  ts: number; // absolute wall-clock ms
  // 'prompt' marks the start of a message the user sent — rendered as a divider
  // so each turn is easy to find in a long trace.
  kind?: 'prompt';
}

// A live run on a brand-new chat happens before the chat has been saved and
// given an id, so its entries land under this pending key and are adopted into
// the real chat id once the turn is saved.
export const PENDING_KEY = '__pending__';

const STORAGE_KEY = 'chatTrace.v1';
const SAVE_DEBOUNCE_MS = 700;
const MAX_PER_CHAT = 600;

interface Persisted {
  buildId: string;
  byChat: Record<string, ChatTraceEntry[]>;
}

interface ChatTraceStore {
  byChat: Record<string, ChatTraceEntry[]>; // newest-first per chat
  activeKey: string;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setActiveKey: (key: string) => void;
  add: (record: Omit<ChatTraceEntry, 'id' | 'ts'>) => void;
  markPrompt: (text: string) => void;
  adoptPending: (chatId: string) => void;
  clearActive: () => void;
  retainChats: (validIds: Set<string>) => void;
}

let seq = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Writes are high-frequency during a run, so persist on a trailing debounce.
function scheduleSave(byChat: Record<string, ChatTraceEntry[]>): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void platform()
      .storage.set<Persisted>(STORAGE_KEY, { buildId: BUILD_ID, byChat })
      .catch(() => {
        /* storage may be unavailable; the in-memory trace still works */
      });
  }, SAVE_DEBOUNCE_MS);
}

function cap(list: ChatTraceEntry[]): ChatTraceEntry[] {
  return list.length > MAX_PER_CHAT ? list.slice(0, MAX_PER_CHAT) : list;
}

export const useChatTraceStore = create<ChatTraceStore>((set, get) => ({
  byChat: {},
  activeKey: PENDING_KEY,
  hydrated: false,

  hydrate: async () => {
    try {
      const stored = await platform().storage.get<Persisted>(STORAGE_KEY);
      // A rebuilt bundle carries a new build id; discard a trace written by an
      // older build so every rebuild starts clean, as the workflow expects.
      const byChat =
        stored && stored.buildId === BUILD_ID && stored.byChat ? stored.byChat : {};
      set({ byChat, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setActiveKey: (key) => set({ activeKey: key || PENDING_KEY }),

  add: (record) =>
    set((state) => {
      const key = state.activeKey;
      const entry: ChatTraceEntry = { ...record, id: `t${++seq}`, ts: Date.now() };
      const next = cap([entry, ...(state.byChat[key] ?? [])]);
      const byChat = { ...state.byChat, [key]: next };
      scheduleSave(byChat);
      return { byChat };
    }),

  markPrompt: (text) => {
    const detail = text.replace(/\s+/g, ' ').trim();
    get().add({ agentId: 'system', phase: 'prompt', detail, kind: 'prompt' });
  },

  // Fold a fresh chat's pending live run into its now-known chat id.
  adoptPending: (chatId) =>
    set((state) => {
      const pending = state.byChat[PENDING_KEY];
      if (!chatId || !pending || pending.length === 0) return {};
      const merged = cap([...pending, ...(state.byChat[chatId] ?? [])]);
      const byChat = { ...state.byChat, [chatId]: merged };
      delete byChat[PENDING_KEY];
      scheduleSave(byChat);
      return { byChat };
    }),

  clearActive: () =>
    set((state) => {
      const byChat = { ...state.byChat };
      delete byChat[state.activeKey];
      scheduleSave(byChat);
      return { byChat };
    }),

  // Drop traces for chats that no longer exist (e.g. a deleted chat), keeping
  // the pending bucket for the in-flight conversation.
  retainChats: (validIds) =>
    set((state) => {
      const stale = Object.keys(state.byChat).filter(
        (k) => k !== PENDING_KEY && !validIds.has(k),
      );
      if (stale.length === 0) return {};
      const byChat = { ...state.byChat };
      for (const id of stale) delete byChat[id];
      scheduleSave(byChat);
      return { byChat };
    }),
}));

let installed = false;

/**
 * Wire the per-chat trace to the activity bus and to chat-history changes.
 * Call once at boot.
 */
export function installChatTrace(): void {
  if (installed) return;
  installed = true;

  void useChatTraceStore
    .getState()
    .hydrate()
    .then(() => {
      // Mirror the active chat into the trace's active key, adopt a fresh chat's
      // pending run once it gets a real id, and drop traces for deleted chats.
      const syncFromHistory = () => {
        const { activeChatId, chats } = useChatHistoryStore.getState();
        const store = useChatTraceStore.getState();
        const key = activeChatId ?? PENDING_KEY;
        if (activeChatId && (store.byChat[PENDING_KEY]?.length ?? 0) > 0) {
          store.adoptPending(activeChatId);
        }
        if (store.activeKey !== key) store.setActiveKey(key);
        store.retainChats(new Set(chats.map((c) => c.id)));
      };
      syncFromHistory();
      useChatHistoryStore.subscribe(syncFromHistory);

      bus.on('agent:activity', (event) => {
        useChatTraceStore.getState().add({
          agentId: event.agentId,
          phase: event.phase,
          ...(event.detail !== undefined ? { detail: event.detail } : {}),
        });
      });
    });
}
