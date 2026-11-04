import type { EvidenceItem } from '@platform/index';
import { neutralizeInjection } from './evidenceSanitize';

const SNIPPET_CHARS = 320;

// Sentences that carry a study's result: an effect estimate, an interval, a
// p-value, a percentage, a labelled results/conclusion section, or a directional
// finding. These are what a model needs to quote numbers faithfully, and in an
// abstract they sit after the background — past where a head cut stops.
// Effect-measure abbreviations are matched case-sensitively: "OR" is an odds
// ratio, "or" is a conjunction.
const RESULT_MEASURE_RX = /\b(?:HR|OR|RR|aHR|aOR|IRR|SMD|WMD|NNT|CI)\b/;
const RESULT_NUMBER_RX = /95\s*%|\bp\s*[<=>≤]\s*0?\.\d|\d+(?:\.\d+)?\s*%|\b\d\.\d{1,3}\b/i;
const RESULT_LABEL_RX = /^(?:results?|findings|conclusions?|interpretation|main outcomes?)\b/i;
const RESULT_WORD_RX =
  /\b(?:reduc|increas|decreas|lower|higher|improv|worsen|significant|associated|no difference|did not|was not)\w*/i;

function splitAbstractSentences(text: string): string[] {
  // A period followed by a space and a capital (or an opening bracket) ends a
  // sentence; decimals ("0.82") and abbreviations without a following capital
  // do not.
  return text.split(/(?<=[.!?])\s+(?=[A-Z(\[])/).map((s) => s.trim()).filter(Boolean);
}

/**
 * An excerpt of an abstract that fits `limit` characters and keeps what matters
 * for synthesis: the opening sentence (what the study is), then the sentences
 * that report results, in their original order. Gaps are marked with an
 * ellipsis so the model never reads two distant sentences as one. Text that
 * already fits is returned unchanged.
 */
export function resultExcerpt(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const sentences = splitAbstractSentences(clean);
  if (sentences.length <= 1) return clean.slice(0, limit);
  const score = (s: string): number =>
    (RESULT_MEASURE_RX.test(s) || RESULT_NUMBER_RX.test(s) ? 4 : 0) +
    (RESULT_LABEL_RX.test(s) ? 2 : 0) +
    (RESULT_WORD_RX.test(s) ? 1 : 0);
  const chosen = new Set<number>([0]);
  let used = sentences[0]!.length;
  const ranked = sentences
    .map((s, i) => ({ i, s, score: score(s) }))
    .filter((x) => x.i > 0 && x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  for (const { i, s } of ranked) {
    if (used + s.length + 3 > limit) continue;
    chosen.add(i);
    used += s.length + 3;
  }
  // Fill any room left with the sentences right after the opening.
  for (let i = 1; i < sentences.length; i += 1) {
    const s = sentences[i]!;
    if (chosen.has(i) || used + s.length + 3 > limit) continue;
    chosen.add(i);
    used += s.length + 3;
  }
  const order = [...chosen].sort((a, b) => a - b);
  let out = '';
  let prev = -1;
  for (const i of order) {
    if (out) out += i === prev + 1 ? ' ' : ' … ';
    out += sentences[i];
    prev = i;
  }
  if (out.length > limit) out = out.slice(0, limit);
  return order[order.length - 1] === sentences.length - 1 ? out : `${out} …`;
}

export interface FormatEvidenceOptions {
  /** Zero-based index used to build the [#] marker. */
  index: number;
  /** Optional prefix for the marker (default ''). */
  markerPrefix?: string | undefined;
  /** Max characters for the snippet (default 320). */
  snippetChars?: number | undefined;
}

/** How much of each abstract the model sees: the first `count` records (the
 *  best-ranked) get `chars` each, chosen to keep their results; the rest keep
 *  the short default. */
export interface DetailTier {
  count: number;
  chars: number;
}

/**
 * Shared evidence formatter used by the boss synthesizer, manuscript writer,
 * and specialist result renderer. Keeps the citation shape identical across
 * the pipeline so the model sees a consistent [#] scheme.
 */
export function formatEvidenceItem(
  record: EvidenceItem,
  options: FormatEvidenceOptions,
): string {
  const { index, markerPrefix = '', snippetChars = SNIPPET_CHARS } = options;
  const year = record.year ? ` (${record.year})` : '';
  const id = record.identifiers?.pmid
    ? ` PMID:${record.identifiers.pmid}`
    : record.identifiers?.doi
      ? ` DOI:${record.identifiers.doi}`
      : '';
  // Title and snippet are untrusted source text — neutralize any embedded
  // prompt-injection before it reaches the model as part of the citation line.
  const title = neutralizeInjection(record.title);
  // A zero budget means title only.
  const snippet =
    record.snippet && snippetChars > 0
      ? ` — ${neutralizeInjection(resultExcerpt(record.snippet, snippetChars))}`
      : '';
  return `[${markerPrefix}${index + 1}] ${record.source.toUpperCase()}${year} ${title}.${id}${snippet}`;
}

/**
 * Format a flat list of evidence items into newline-separated citation lines.
 */
export function formatEvidenceList(
  evidence: EvidenceItem[],
  opts?: { startIndex?: number; markerPrefix?: string; snippetChars?: number; maxItems?: number; detail?: DetailTier },
): string {
  const start = opts?.startIndex ?? 0;
  const slice = opts?.maxItems !== undefined ? evidence.slice(0, opts.maxItems) : evidence;
  if (slice.length === 0) return '(no source records were retrieved)';
  return slice
    .map((record, offset) =>
      formatEvidenceItem(record, {
        index: start + offset,
        markerPrefix: opts?.markerPrefix,
        snippetChars:
          opts?.detail && offset < opts.detail.count ? opts.detail.chars : opts?.snippetChars,
      }),
    )
    .join('\n');
}
