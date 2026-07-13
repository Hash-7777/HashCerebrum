// Rolling conversation summary (compaction).
//
// The sliding window keeps only recent turns verbatim; without this, everything
// older is simply forgotten. This folds the evicted turns into a running summary
// that is carried forward every turn, so the GIST of the whole conversation
// survives even when the raw turns are dropped — the way a good agent compacts
// its own history rather than truncating it.
//
// The summariser is injected (a plain async fn) so the logic is testable without
// a live model; runSwarm supplies one backed by the boss model chain.

import type { LlmMessage } from '@core/llm/types';

const SUMMARY_SYSTEM =
  'You maintain a running memory of a biomedical research conversation so it can ' +
  'continue without resending the whole transcript. Update the summary to preserve, ' +
  'concisely and factually: the user’s goals and constraints; every drug, gene, ' +
  'variant, condition, population, and study explicitly discussed, WITH their key ' +
  'numbers (effect sizes, confidence intervals, verdicts); decisions and conclusions ' +
  'reached; and any document the team produced (its topic and headline findings). ' +
  'Do not invent anything not present in the turns. Output ONLY the updated summary, ' +
  'no preamble.';

/** The turns that should be folded into the summary: everything older than the
 *  recent verbatim window. Empty when the conversation still fits the window. */
export function turnsToCompact(conversation: LlmMessage[], keepRecent: number): LlmMessage[] {
  if (keepRecent < 0 || conversation.length <= keepRecent) return [];
  return conversation.slice(0, conversation.length - keepRecent);
}

/** The messages sent to the summariser to fold `toFold` into `priorSummary`. */
export function buildSummaryMessages(priorSummary: string, toFold: LlmMessage[]): LlmMessage[] {
  const transcript = toFold.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
  const prior = priorSummary.trim() ? `Existing summary:\n${priorSummary.trim()}\n\n` : '';
  return [
    { role: 'system', content: SUMMARY_SYSTEM },
    { role: 'user', content: `${prior}New turns to fold in:\n${transcript}\n\nReturn the updated summary.` },
  ];
}

/**
 * Produce the updated running summary. Returns the prior summary unchanged when
 * there is nothing to fold in or the summariser fails, so compaction can never
 * break a turn — a lost summary just means the recent window still stands.
 */
export async function updateRunningSummary(
  priorSummary: string,
  toFold: LlmMessage[],
  summarise: (messages: LlmMessage[]) => Promise<string>,
): Promise<string> {
  if (toFold.length === 0) return priorSummary;
  try {
    const out = (await summarise(buildSummaryMessages(priorSummary, toFold))).trim();
    return out.length > 0 ? out : priorSummary;
  } catch {
    return priorSummary;
  }
}
