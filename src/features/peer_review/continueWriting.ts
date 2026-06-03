// Citation-aware continue-writing. Extends the passage at the cursor by ONE to
// THREE sentences, asserting only what the document's own retrieved sources
// support and citing them with [n] markers. This is the safe form of
// autocomplete: it cannot invent an unsourced claim, because the model is given
// the exact source snippets and told to cite or stay silent. The prompt builder
// and the marker guard are pure and unit-tested; only continueWriting calls the
// model.

import { completeWithModelChain } from '@core/llm/ProviderRegistry';
import type { EvidenceItem } from '@platform/index';
import { extractMarkers } from './rewriteSelection';

const SNIPPET_CHARS = 280;
const MAX_SOURCES = 12;
const TAIL_CHARS = 1500;

const SYSTEM = `You continue a biomedical manuscript by ONE to THREE sentences from where it stops. Strict rules:
- Assert only what the provided numbered sources support. Cite each new claim with its source marker, e.g. [2].
- Do NOT use any marker that is not in the provided source list, and do not invent facts or statistics.
- If the sources cannot support a sensible continuation, reply with exactly: NONE
- Do not repeat the existing text; write only the new sentences, no preamble.`;

export interface ContinueSources {
  text: string;
  /** Highest valid marker number (sources are numbered 1..count). */
  count: number;
}

/** Build the numbered source block the model may cite from. */
export function buildSourceBlock(citations: EvidenceItem[]): ContinueSources {
  const usable = citations.slice(0, MAX_SOURCES);
  const text = usable
    .map((c, i) => `[${i + 1}] ${c.title}: ${(c.snippet ?? '').trim().slice(0, SNIPPET_CHARS)}`)
    .join('\n');
  return { text, count: usable.length };
}

export function buildContinuePrompt(precedingText: string, sources: ContinueSources): string {
  const tail = precedingText.slice(-TAIL_CHARS);
  return `SOURCES YOU MAY CITE:\n${sources.text}\n\nMANUSCRIPT SO FAR (continue from the end):\n${tail}`;
}

/** True when every marker in `text` is within 1..count (no invented sources). */
export function markersWithinRange(text: string, count: number): boolean {
  return extractMarkers(text).every((n) => n >= 1 && n <= count);
}

export interface ContinueResult {
  /** The new sentences to append, or empty string when nothing could be added. */
  text: string;
}

/**
 * Generate a grounded continuation for the text preceding the cursor. Returns
 * empty text when the model declines (NONE) or when it tried to cite a source
 * that was not provided — so a continuation can never smuggle in an unsourced
 * or mis-cited claim.
 */
export async function continueWriting(
  model: string,
  precedingText: string,
  citations: EvidenceItem[],
): Promise<ContinueResult> {
  const sources = buildSourceBlock(citations);
  if (sources.count === 0) return { text: '' };
  const res = await completeWithModelChain(model, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildContinuePrompt(precedingText, sources) },
    ],
    temperature: 0.4,
    maxTokens: 260,
  });
  const out = res.content.trim();
  if (!out || /^none\b/i.test(out)) return { text: '' };
  if (!markersWithinRange(out, sources.count)) return { text: '' };
  return { text: out };
}
