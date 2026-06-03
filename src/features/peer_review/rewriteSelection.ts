// Rewrite-selection — rephrase a highlighted passage in a chosen register while
// keeping every citation marker intact. HashCerebrum's promise is "no claim
// without a source", so a rewrite must never drop, add, or renumber a `[n]`
// marker: the prose may change, the evidence trail may not. The prompt builder
// and the marker-guard are pure and unit-tested; only the orchestrator touches
// the model.

import { completeWithModelChain } from '@core/llm/ProviderRegistry';

export type RewriteRegister = 'concise' | 'plain' | 'formal';

export const REWRITE_REGISTERS: { value: RewriteRegister; label: string; hint: string }[] = [
  { value: 'concise', label: 'Concise', hint: 'Tighten — remove redundancy, keep the meaning' },
  { value: 'plain', label: 'Plain language', hint: 'Explain for a non-specialist reader' },
  { value: 'formal', label: 'Formal', hint: 'Polished, formal academic journal tone' },
];

const REGISTER_INSTRUCTION: Record<RewriteRegister, string> = {
  concise:
    'Rewrite the passage to be more concise: remove redundancy and filler, keep every fact and nuance.',
  plain:
    'Rewrite the passage in plain language a non-specialist can follow, without dumbing down the medical facts.',
  formal:
    'Rewrite the passage in a polished, formal academic register suitable for a peer-reviewed medical journal.',
};

/** All distinct `[n]` citation markers in a passage, in order of appearance. */
export function extractMarkers(text: string): number[] {
  const out: number[] = [];
  const rx = /\[(\d{1,3})\]/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/** True when `rewritten` cites exactly the same set of markers as `original`. */
export function markersPreserved(original: string, rewritten: string): boolean {
  const a = extractMarkers(original);
  const b = extractMarkers(rewritten);
  if (a.length !== b.length) return false;
  return a.every((n, i) => n === b[i]);
}

const SYSTEM = `You are a medical-manuscript copy editor. You rewrite a single passage on request. Absolute rules:
- Preserve every citation marker exactly as written, e.g. [3], [12]. Do not add, remove, renumber, or reorder them.
- Do not introduce any new factual claim, statistic, or assertion that is not already in the passage.
- Keep the same meaning; change only wording and style.
Reply with ONLY the rewritten passage — no preamble, no quotes, no explanation.`;

export function buildRewritePrompt(passage: string, register: RewriteRegister): string {
  return `${REGISTER_INSTRUCTION[register]}\n\nPASSAGE:\n${passage}`;
}

export interface RewriteResult {
  text: string;
  /** False when the model altered the citation markers — caller should reject. */
  markersOk: boolean;
}

/**
 * Rewrite `passage` in the requested register. Returns the rewritten text and
 * whether the citation markers were preserved; the caller decides whether to
 * apply it. Throws only on a hard model/transport failure.
 */
export async function rewriteSelection(
  model: string,
  passage: string,
  register: RewriteRegister,
): Promise<RewriteResult> {
  const res = await completeWithModelChain(model, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildRewritePrompt(passage, register) },
    ],
    temperature: 0.3,
    maxTokens: 900,
  });
  const text = res.content.trim().replace(/^["']|["']$/g, '').trim();
  return { text, markersOk: markersPreserved(passage, text) };
}
