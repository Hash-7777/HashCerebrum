// Ask-this-paper — a grounded Q&A over a single document (typically an uploaded
// PDF). The model may answer ONLY from passages taken verbatim from the paper,
// and must cite them with [P#] markers, so every answer is click-to-verifiable
// against the exact text it came from. If the paper does not address a question
// the model is told to say so rather than guess. Passage splitting, ranking and
// the prompt builder are pure and unit-tested; only askPaper touches the model.

import { completeWithModelChain } from '@core/llm/ProviderRegistry';

export interface PaperPassage {
  /** 1-based passage number used in [P#] markers. */
  index: number;
  text: string;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is',
  'are', 'was', 'were', 'be', 'by', 'at', 'as', 'that', 'this', 'it', 'from',
  'what', 'which', 'how', 'does', 'do', 'did', 'why', 'when', 'who', 'whom',
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Split a document into passages on blank-line boundaries, merging very short
 * fragments forward so each passage carries enough context to stand alone.
 */
export function chunkPaper(text: string, minChars = 240): PaperPassage[] {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const merged: string[] = [];
  for (const block of blocks) {
    const last = merged.at(-1);
    if (last !== undefined && last.length < minChars) {
      merged[merged.length - 1] = `${last} ${block}`;
    } else {
      merged.push(block);
    }
  }
  return merged.map((text, i) => ({ index: i + 1, text }));
}

/**
 * Rank passages by lexical overlap with the query and return the top `k`
 * (re-numbered 1..k for the prompt). Pure and deterministic.
 */
export function rankPassages(query: string, passages: PaperPassage[], k = 6): PaperPassage[] {
  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0) return passages.slice(0, k).map((p, i) => ({ index: i + 1, text: p.text }));
  const scored = passages.map((p) => {
    const terms = tokenize(p.text);
    let hits = 0;
    for (const t of terms) if (queryTerms.has(t)) hits += 1;
    // Normalise slightly by length so a long passage doesn't always win.
    return { passage: p, score: hits / Math.sqrt(terms.length + 1) };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s, i) => ({ index: i + 1, text: s.passage.text }));
}

const SYSTEM = `You answer questions about ONE document. You are given numbered passages taken verbatim from it. Rules:
- Use ONLY the information in the passages. Do not use outside knowledge.
- Cite every claim with the passage number(s) it comes from, e.g. [P2].
- If the passages do not contain the answer, reply exactly: "The paper does not address this."
- Be concise and precise.`;

export function buildAskPrompt(question: string, passages: PaperPassage[]): string {
  const body = passages.map((p) => `[P${p.index}] ${p.text}`).join('\n\n');
  return `PASSAGES:\n${body}\n\nQUESTION: ${question}`;
}

/** Distinct [P#] markers actually cited in an answer, in order of appearance. */
export function citedPassageNumbers(answer: string): number[] {
  const out: number[] = [];
  const rx = /\[P(\d{1,3})\]/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(answer)) !== null) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

export interface AskResult {
  answer: string;
  /** The passages sent to the model (1..k), so the UI can verify each [P#]. */
  passages: PaperPassage[];
}

export async function askPaper(
  model: string,
  question: string,
  documentText: string,
): Promise<AskResult> {
  const passages = rankPassages(question, chunkPaper(documentText), 6);
  if (passages.length === 0) {
    return { answer: 'The paper does not address this.', passages: [] };
  }
  const res = await completeWithModelChain(model, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildAskPrompt(question, passages) },
    ],
    temperature: 0.2,
    maxTokens: 700,
  });
  return { answer: res.content.trim(), passages };
}
