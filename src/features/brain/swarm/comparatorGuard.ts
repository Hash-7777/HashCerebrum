// Comparator-faithfulness guard for the paper path.
//
// A head-to-head question ("compare SGLT2 inhibitors WITH GLP-1 receptor
// agonists for MACE") often retrieves no direct comparison of the two arms — the
// literature compares each arm against placebo or "other glucose-lowering drugs".
// Left to itself the drafting model takes a pooled estimate from one such source
// (e.g. an odds ratio for "SGLT2 inhibitors versus other glucose-lowering drugs")
// and re-frames it as the answer to the asked head-to-head — "an odds ratio of
// 0.71 for SGLT2 inhibitors relative to GLP-1 receptor agonists". That is a lie
// the reader cannot catch: the number is real but the comparator is fabricated.
//
// This guard removes only the fabricated comparator clause, keeping the estimate
// attributed to its own arm. It is deliberately conservative: it fires ONLY when
// the question is a clear two-arm comparison, BOTH arms carry a distinctive
// signature token, NO retrieved source is a genuine head-to-head of the two arms,
// and the sentence both reports an effect estimate and names the other arm as its
// comparator. When a real head-to-head source exists, or the arms cannot be
// identified with confidence, it does nothing — it never rewrites a legitimate
// comparison.

import type { EvidenceItem } from '@platform/index';

// Generic words that are not part of an arm's identity — they describe the ask,
// the population, or the outcome, so they never distinguish one drug class from
// another.
const ARM_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'with', 'to', 'on', 'at',
  'risk', 'events', 'event', 'disease', 'adults', 'patients', 'people', 'major',
  'adverse', 'cardiovascular', 'other', 'both', 'use', 'using', 'therapy',
  'therapies', 'treatment', 'treatments', 'outcome', 'outcomes', 'point',
]);

// Class descriptors shared across drug classes ("inhibitors", "receptor
// agonists"). They belong to an arm phrase but do not, on their own, identify it —
// so they are excluded when deciding whether a source truly named BOTH arms.
const CLASS_DESCRIPTOR = new Set([
  'inhibitor', 'inhibitors', 'agonist', 'agonists', 'antagonist', 'antagonists',
  'blocker', 'blockers', 'receptor', 'receptors', 'analogue', 'analogues', 'analog', 'analogs',
]);

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function armTokens(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !ARM_STOP.has(t));
}

// The token(s) that actually identify an arm — its tokens minus the generic class
// descriptors. "SGLT2 inhibitors" → ["sglt2"]; "GLP-1 receptor agonists" →
// ["glp-1"]. If nothing distinctive remains, the arm cannot be identified.
function signatureTokens(tokens: string[]): string[] {
  return tokens.filter((t) => !CLASS_DESCRIPTOR.has(t));
}

export interface ComparisonArms {
  a: string[]; // all tokens of arm A (incl. descriptors), for clause matching
  b: string[];
  aSig: string[]; // distinctive tokens of arm A, for head-to-head detection
  bSig: string[];
}

const COMPARE_RX: RegExp[] = [
  /\bcompar(?:e|es|ed|ing|ison\s+of)?\s+(.+?)\s+(?:with|to|versus|vs\.?|against)\s+(.+?)(?=\s\bfor\b|\s\bin\b|\s\bamong\b|\s\bregarding\b|[,.;:]|$)/i,
  /\b([a-z0-9][\w /-]*?)\s+(?:versus|vs\.?)\s+([a-z0-9][\w /-]*?)(?=\s\bfor\b|\s\bin\b|\s\bamong\b|[,.;:]|$)/i,
];

/** Extract the two comparison arms from a head-to-head question, or null when the
 *  question is not a clear two-arm comparison or the arms lack a distinctive
 *  identifying token. Pure and deterministic. */
export function comparisonArms(question: string): ComparisonArms | null {
  for (const rx of COMPARE_RX) {
    const m = question.match(rx);
    if (!m) continue;
    const a = armTokens(m[1] ?? '');
    const b = armTokens(m[2] ?? '');
    const aSig = signatureTokens(a);
    const bSig = signatureTokens(b);
    // Both arms must carry a distinctive token, and the two arms must not be the
    // same thing — otherwise we cannot tell them apart in a sentence.
    if (aSig.length === 0 || bSig.length === 0) continue;
    if (aSig.some((t) => bSig.includes(t))) continue;
    return { a, b, aSig, bSig };
  }
  return null;
}

function mentionsAny(text: string, tokens: string[]): boolean {
  return tokens.some((tok) => new RegExp(`\\b${escapeRx(tok)}\\b`, 'i').test(text));
}

const COMPARATIVE_CUE_RX =
  /\b(?:versus|vs\.?|compared\s+(?:with|to|against)|head[\s-]to[\s-]head|relative\s+to|superior\s+to|non[\s-]?inferior(?:ity)?|comparative\s+effectiveness)\b/i;

/** True when at least one retrieved source is a genuine head-to-head of the two
 *  arms: it names a distinctive token of BOTH arms and carries a comparative cue.
 *  A background source that merely co-mentions both classes without comparing them
 *  does not count. */
export function hasHeadToHeadEvidence(evidence: EvidenceItem[], arms: ComparisonArms): boolean {
  return evidence.some((item) => {
    const text = `${item.title ?? ''} ${item.snippet ?? ''}`;
    return mentionsAny(text, arms.aSig) && mentionsAny(text, arms.bSig) && COMPARATIVE_CUE_RX.test(text);
  });
}

// A sentence reports an effect estimate when it names a ratio measure. Paired with
// a digit so a bare "or"/"hr" word cannot trigger it.
const EFFECT_RATIO_RX =
  /\b(?:hazard\s+ratio|odds\s+ratio|risk\s+ratio|relative\s+risk|HR|OR|RR)\b[^.]{0,40}?\d/;

/** Remove a fabricated comparator clause ("relative to GLP-1 receptor agonists")
 *  from an effect-estimate sentence when the question's other arm is named there
 *  and no head-to-head source exists. Returns the cleaned text and the removed
 *  spans (for tracing). Conservative: unchanged when arms are unclear or a real
 *  head-to-head source is present. */
export function neutralizeUnsupportedComparator(
  text: string,
  question: string,
  evidence: EvidenceItem[],
): { text: string; removed: string[] } {
  const arms = comparisonArms(question);
  if (!arms) return { text, removed: [] };
  if (hasHeadToHeadEvidence(evidence, arms)) return { text, removed: [] };

  // Words that may appear inside an arm phrase after the connective: the arm's own
  // tokens plus generic class descriptors and articles, so "compared with GLP-1
  // receptor agonists" is captured whole while "in adults" stops the phrase.
  const armWords = [...new Set([...arms.a, ...arms.b, ...CLASS_DESCRIPTOR, 'the', 'a'])];
  const armAlt = armWords.map(escapeRx).join('|');
  const connective = '(?:relative\\s+to|as\\s+compared\\s+(?:with|to)|compared\\s+(?:with|to|against)|versus|vs\\.?|against)';
  const clauseRx = new RegExp(`(\\s*,?\\s*)\\b${connective}\\s+((?:(?:${armAlt})[\\s-]+)*(?:${armAlt}))\\b`, 'gi');
  // A clause only counts when its captured phrase actually names an arm token
  // (not just descriptors/articles) — so "compared with placebo" or "versus other
  // glucose-lowering drugs" is left untouched.
  const armTokenRx = new RegExp(`\\b(?:${[...arms.a, ...arms.b].map(escapeRx).join('|')})\\b`, 'i');

  const removed: string[] = [];
  const out = text.replace(clauseRx, (full: string, _lead: string, phrase: string, offset: number) => {
    // Only act inside a sentence that reports an effect estimate.
    const sentence = sentenceAround(text, offset);
    if (!EFFECT_RATIO_RX.test(sentence)) return full;
    if (!armTokenRx.test(phrase)) return full;
    removed.push(full.trim());
    return '';
  });
  if (removed.length === 0) return { text, removed };
  const cleaned = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:)])/g, '$1').trim();
  return { text: cleaned, removed };
}

/** The sentence containing a character offset — bounded by sentence punctuation on
 *  either side. A period is a boundary only when followed by whitespace or the end
 *  of the text, so a decimal ("0.71") never splits the sentence and hides the
 *  effect ratio. Used to test the local sentence for an effect ratio. */
function sentenceAround(text: string, offset: number): string {
  const isBoundary = (i: number): boolean =>
    /[.!?]/.test(text[i] ?? '') && (i + 1 >= text.length || /\s/.test(text[i + 1] ?? ''));
  let start = offset;
  while (start > 0 && !isBoundary(start - 1)) start -= 1;
  let end = offset;
  while (end < text.length && !isBoundary(end)) end += 1;
  return text.slice(start, end + 1);
}
