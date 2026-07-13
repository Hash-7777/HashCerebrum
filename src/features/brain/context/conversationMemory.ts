// Isolated semantic recall over CONVERSATION turns (Layer 3).
//
// ISOLATION — CRITICAL: this store is entirely separate from the project RAG /
// paper-knowledge system (`@core/rag` ragStore). It keeps its own chat-keyed
// vectors here and NEVER writes to, or reads from, ragStore. It only reuses the
// shared on-device embedding MODEL (the same weights) — sharing a model is not
// sharing data. Consequently a chat turn can never surface as paper "evidence"
// (the paper pipeline reads ragStore only), and a cited medical finding can never
// surface as chat recall (recall reads this store only). Do NOT import ragStore
// here, and do NOT route conversation turns through addChunks.
//
// Purpose: for a new message, retrieve the most RELEVANT earlier turns — even
// ancient ones outside the recent window — so "what was the OR you found for
// MTHFR earlier?" pulls that exact turn back. The embedder is injected so the
// logic is unit-testable without the worker; runSwarm passes the shared provider.

import type { LlmMessage } from '@core/llm/types';
import { cosineSim } from '@core/rag/search/cosine';

/** The subset of the embedding provider this module needs. */
export interface TurnEmbedder {
  readonly ready: boolean;
  embed(texts: string[], kind?: 'query' | 'passage'): Promise<Float32Array[]>;
}

interface StoredTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  vec: Float32Array;
}

// Chat id → its turn vectors. Module-scoped, mirroring how ragStore keeps its
// float vectors in module scope — but a DISTINCT map, so the two never mix.
const byChat = new Map<string, StoredTurn[]>();

// Bound memory: keep at most this many turns per chat (drop oldest).
const MAX_TURNS_PER_CHAT = 400;

export interface TurnInput {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

/** Embed and store the given turns for a chat (skipping ones already stored by
 *  id, and no-op when the embedder is not ready). Best-effort: a failure never
 *  throws into the caller. */
export async function rememberTurns(
  chatId: string,
  turns: TurnInput[],
  embedder: TurnEmbedder,
): Promise<void> {
  if (!chatId || !embedder.ready || turns.length === 0) return;
  const existing = byChat.get(chatId) ?? [];
  const knownIds = new Set(existing.map((t) => t.id));
  const fresh = turns.filter((t) => t.content.trim().length > 0 && !knownIds.has(t.id));
  if (fresh.length === 0) return;
  try {
    const vecs = await embedder.embed(
      fresh.map((t) => t.content),
      'passage',
    );
    const stored = [...existing];
    fresh.forEach((t, i) => {
      const vec = vecs[i];
      if (vec) stored.push({ id: t.id, role: t.role, content: t.content, vec });
    });
    // Keep the most recent MAX_TURNS_PER_CHAT.
    byChat.set(chatId, stored.slice(-MAX_TURNS_PER_CHAT));
  } catch {
    /* embedding failed — recall simply has less to draw on this turn */
  }
}

export interface RecallOptions {
  /** Max turns to return (default 4). */
  k?: number;
  /** Minimum cosine similarity to include (default 0.35). */
  minScore?: number;
  /** Turn ids already present in the recent window — excluded so recall does not
   *  duplicate what the caller already includes verbatim. */
  excludeIds?: Set<string>;
}

/**
 * The most relevant earlier turns in THIS chat for `query`, as chat messages in
 * their original order. Returns [] when the embedder is cold, the chat has no
 * stored turns, or nothing clears the similarity threshold.
 */
export async function recallTurns(
  chatId: string,
  query: string,
  embedder: TurnEmbedder,
  opts: RecallOptions = {},
): Promise<LlmMessage[]> {
  const turns = byChat.get(chatId);
  if (!chatId || !embedder.ready || !turns || turns.length === 0 || !query.trim()) return [];
  const k = opts.k ?? 4;
  const minScore = opts.minScore ?? 0.35;
  const exclude = opts.excludeIds ?? new Set<string>();
  let qvec: Float32Array | undefined;
  try {
    qvec = (await embedder.embed([query], 'query'))[0];
  } catch {
    return [];
  }
  if (!qvec) return [];
  const scored = turns
    .filter((t) => !exclude.has(t.id))
    .map((t, index) => ({ t, index, score: cosineSim(qvec, t.vec) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    // back to chronological order so the recalled snippets read naturally
    .sort((a, b) => a.index - b.index);
  return scored.map(({ t }) => ({ role: t.role, content: t.content }));
}

/** Forget a chat's turn vectors (call when a chat is deleted). */
export function forgetChat(chatId: string): void {
  byChat.delete(chatId);
}

/** Test/maintenance helper: drop all stored conversation vectors. */
export function clearAllConversationMemory(): void {
  byChat.clear();
}
