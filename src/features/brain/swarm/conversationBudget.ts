// Keep the conversation context sent to the model within a size budget.
//
// Every prior turn is stored in full (a research answer is a whole manuscript),
// and the routing / follow-up / chat calls previously replayed that history —
// planResearch sent the ENTIRE conversation, so a long chat grew the request
// without bound until a small-context model returned "message too long" (413).
//
// This trims the history the way a good assistant does: keep the most RECENT
// turns (they carry the live context), cap each long assistant answer to a head
// excerpt (the routing/follow-up model needs the gist, not the full paper), and
// stop once a character budget is reached — always keeping at least the latest
// turn. The raw conversation is left untouched for callers that genuinely need a
// full prior answer (e.g. appraising a paper the team just wrote).

import type { LlmMessage } from '@core/llm/types';

export interface BudgetOptions {
  /** Approximate character ceiling for the whole returned context. */
  maxChars: number;
  /** Longest a single assistant message may be before it is head-truncated. */
  perAssistantChars?: number;
  /** Hard cap on the number of turns kept, newest-first. */
  maxTurns?: number;
}

const TRUNCATION_NOTE = ' …[earlier answer truncated]';

/** Head excerpt of a long assistant answer — the opening carries the topic,
 *  question framing, and headline findings the router/follow-up needs. */
function clampAssistant(content: string, limit: number): string {
  if (content.length <= limit) return content;
  return content.slice(0, Math.max(0, limit - TRUNCATION_NOTE.length)).trimEnd() + TRUNCATION_NOTE;
}

/**
 * Return the most recent slice of `conversation` that fits the budget, in
 * chronological order. Assistant messages longer than `perAssistantChars` are
 * head-truncated; turns beyond `maxChars` (or `maxTurns`) are dropped, oldest
 * first. The latest turn is always kept even if it alone exceeds the budget.
 */
/**
 * Short things the person said earlier in the chat that fell outside the kept
 * window — a name, a role, a constraint ("keep it at bench level"). Long turns
 * are research questions the window and the recall already cover; these short
 * ones are cheap and are exactly what a person expects a conversation partner to
 * remember. Newest first until the budget is spent, returned oldest first.
 */
export function earlierUserLines(
  conversation: LlmMessage[],
  kept: LlmMessage[],
  opts: { maxLineChars?: number; maxChars?: number } = {},
): string[] {
  const maxLine = opts.maxLineChars ?? 240;
  const budget = opts.maxChars ?? 1200;
  const keptText = new Set(kept.map((m) => m.content));
  const out: string[] = [];
  let total = 0;
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const msg = conversation[i];
    if (!msg || msg.role !== 'user') continue;
    const line = msg.content.replace(/\s+/g, ' ').trim();
    if (!line || line.length > maxLine || keptText.has(msg.content)) continue;
    if (total + line.length > budget) break;
    out.unshift(line);
    total += line.length;
  }
  return out;
}

export function budgetConversation(
  conversation: LlmMessage[],
  opts: BudgetOptions,
): LlmMessage[] {
  const perAssistant = opts.perAssistantChars ?? 1500;
  const maxTurns = opts.maxTurns ?? Number.POSITIVE_INFINITY;
  const out: LlmMessage[] = [];
  let total = 0;
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const msg = conversation[i];
    if (!msg) continue;
    const content =
      msg.role === 'assistant' ? clampAssistant(msg.content, perAssistant) : msg.content;
    // Always keep the newest turn; otherwise stop once the budget is spent.
    if (out.length > 0 && (total + content.length > opts.maxChars || out.length >= maxTurns)) {
      break;
    }
    out.unshift({ role: msg.role, content });
    total += content.length;
  }
  return out;
}
