// Persisted chat history. The brain workspace keeps the live conversation
// in component state and snapshots it here at the end of every turn; the
// left rail lists the snapshots so a past conversation can be reopened.
//
// activeChatId is runtime-only — it is not persisted, so every launch
// starts on a fresh transcript with the saved chats available in the rail.
// Persisted shape through the platform storage adapter: Tauri Store in the
// desktop shell, localStorage in browser dev.

import { create } from 'zustand';
import type { EvidenceItem } from '@platform/index';
import { platform } from '@platform/index';
import type { Manuscript } from '@features/brain/swarm/manuscript';
import { useProjectStore } from './projectStore';

const STORAGE_KEY = 'chatHistory.v1';
const MAX_CHATS = 100;
const TITLE_MAX = 48;

export interface TurnTraceEntry {
  agent: string;
  phase: string;
  detail: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: EvidenceItem[];
  modelLabel?: string;
  failoverNote?: string;
  error?: string;
  critiqueOf?: string;
  isStreaming?: boolean;
  // Present on a full-paper assistant message — the structured manuscript
  // the PDF export renders deterministically.
  manuscript?: Manuscript;
  // Present on an outline-first proposal message — carries the original query so
  // the "Draft full paper" action can run the real pipeline on approval.
  outlineProposal?: { query: string };
  // Execution trace for this turn: boss phases, specialist calls, tool results.
  trace?: TurnTraceEntry[];
  // Cited sentences the offline NLI fact-check did not find clearly supported by
  // their source. Present only after a research answer has been verified.
  unsupportedClaims?: string[];
}

// Which workspace produced a chat. Brain and Drug-Interactions keep separate
// histories so an interaction report never lands among research papers.
// Absent on chats saved before this field existed — treated as 'brain'.
export type ChatMode = 'brain' | 'drug_interactions' | 'genetics';

export interface SavedChat {
  id: string;
  title: string;
  projectId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  mode?: ChatMode;
  // True once the user has manually renamed the chat — saveActive then
  // keeps that title instead of re-deriving it from the first message.
  titleCustom?: boolean;
}

interface PersistShape {
  chats: SavedChat[];
}

interface ChatHistoryStore {
  chats: SavedChat[];
  activeChatId: string | null;
  hydrated: boolean;
  hydrate: (fallbackProjectId?: string) => Promise<void>;
  newChat: (mode?: ChatMode) => string;
  selectChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  saveActive: (messages: ChatMessage[], mode?: ChatMode) => void;
  clearActive: () => void;
  deleteChat: (id: string) => void;
  deleteChatsForProject: (projectId: string) => void;
}

// The active project a new or freshly created chat belongs to. Resolved
// lazily so this store never imports projectStore state at module load.
function currentProjectId(): string {
  return useProjectStore.getState().activeProjectId ?? '';
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user');
  const text = firstUser?.content.replace(/\s+/g, ' ').trim();
  if (!text) return 'New chat';
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX).trimEnd()}…` : text;
}

function persist(chats: SavedChat[]) {
  void platform()
    .storage.set<PersistShape>(STORAGE_KEY, { chats })
    .catch((err: unknown) => {
      console.error('[chatHistoryStore] persist failed:', err);
    });
}

async function loadPersisted(): Promise<SavedChat[]> {
  try {
    const stored = await platform().storage.get<PersistShape>(STORAGE_KEY);
    return Array.isArray(stored?.chats) ? stored.chats : [];
  } catch (error) {
    console.warn('[chatHistoryStore] Failed to load persisted chats:', error);
    return [];
  }
}

export const useChatHistoryStore = create<ChatHistoryStore>((set) => ({
  chats: [],
  activeChatId: null,
  hydrated: false,

  hydrate: async (fallbackProjectId) => {
    const loaded = await loadPersisted();
    // Migration: chats saved before projects existed have no projectId.
    // Adopt them into the passed project so existing history is not lost.
    if (!fallbackProjectId) {
      set({ chats: loaded, hydrated: true });
      return;
    }
    const adoptInto = fallbackProjectId;
    const chats = loaded.map((chat) =>
      chat.projectId ? chat : { ...chat, projectId: adoptInto },
    );
    set({ chats, hydrated: true });
  },

  newChat: (mode = 'brain') => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const chat: SavedChat = {
      id,
      title: 'New chat',
      projectId: currentProjectId(),
      messages: [],
      createdAt: now,
      updatedAt: now,
      mode,
    };
    set((state) => {
      // Drop any earlier empty drafts so repeated New chat clicks do not
      // pile up blank entries in the rail.
      const pruned = state.chats.filter((c) => c.messages.length > 0);
      const chats = [chat, ...pruned].slice(0, MAX_CHATS);
      persist(chats);
      return { chats, activeChatId: id };
    });
    return id;
  },

  selectChat: (id) => set({ activeChatId: id }),

  renameChat: (id, title) =>
    set((state) => {
      const next = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || 'Untitled chat';
      const chats = state.chats.map((c) =>
        c.id === id ? { ...c, title: next, titleCustom: true } : c,
      );
      persist(chats);
      return { chats };
    }),

  saveActive: (messages, mode = 'brain') => {
    const cleaned = messages.map((message) => ({ ...message, isStreaming: false }));
    const title = deriveTitle(cleaned);
    const now = new Date().toISOString();
    set((state) => {
      // Only fold into the active chat when it belongs to the SAME mode —
      // otherwise a Drug-Interactions turn would overwrite the Brain chat the
      // user last opened (and vice versa). Mismatched/none ⇒ start a new chat.
      const active = state.chats.find((c) => c.id === state.activeChatId);
      const canUpdate = !!active && (active.mode ?? 'brain') === mode;
      let activeChatId = state.activeChatId;
      let chats: SavedChat[];
      if (canUpdate) {
        chats = state.chats.map((c) =>
          c.id === activeChatId
            ? { ...c, title: c.titleCustom ? c.title : title, messages: cleaned, updatedAt: now }
            : c,
        );
      } else {
        activeChatId = crypto.randomUUID();
        chats = [
          {
            id: activeChatId,
            title,
            projectId: currentProjectId(),
            messages: cleaned,
            createdAt: now,
            updatedAt: now,
            mode,
          },
          ...state.chats.filter((c) => c.messages.length > 0),
        ].slice(0, MAX_CHATS);
      }
      persist(chats);
      return { chats, activeChatId };
    });
  },

  clearActive: () =>
    set((state) => {
      // Remove any empty draft that was the active chat so it doesn't clutter
      // the rail, then clear the selection.
      const chats = state.chats.filter((c) => c.id !== state.activeChatId || c.messages.length > 0);
      persist(chats);
      return { chats, activeChatId: null };
    }),

  deleteChat: (id) =>
    set((state) => {
      const chats = state.chats.filter((c) => c.id !== id);
      persist(chats);
      return { chats, activeChatId: state.activeChatId === id ? null : state.activeChatId };
    }),

  // Cascade used when a project is deleted — drops every chat that belonged
  // to it. Orchestrated by ProjectSelector so the stores stay decoupled.
  deleteChatsForProject: (projectId) =>
    set((state) => {
      const chats = state.chats.filter((c) => c.projectId !== projectId);
      persist(chats);
      const activeChatId =
        state.activeChatId && !chats.some((c) => c.id === state.activeChatId)
          ? null
          : state.activeChatId;
      return { chats, activeChatId };
    }),
}));
