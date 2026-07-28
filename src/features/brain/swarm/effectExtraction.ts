// Reading effect estimates out of retrieved source text.
//
// Everything here turns an abstract into numbers: sample sizes, ratio estimates
// with their own confidence intervals and p-values, and the direction each one
// points. It is pure text-to-number parsing with no knowledge of manuscripts,
// evidence records or the drafting pipeline, which is why it lives on its own.
//
// The plausibility rules are the load-bearing part and each one is a scar. A
// bare integer is never a ratio, because the English word "or" followed by a
// count produced phantom "odds ratio 150" rows. A two-letter abbreviation must
// be uppercase in the source, for the same reason. A confidence interval must be
// a proper ordered pair, and — in `extractBoundEffects` — must actually bracket
// the estimate it is attached to, because a garbled abstract otherwise glued
// "OR 2.08" to "95% CI 2.88-3.77". Loosening any of these puts invented
// statistics into a manuscript, so they are guarded by tests rather than taste.

import type { BoundEffect, ExtractedEffectValue } from './publicationTypes';
import { clean } from './textNormalize';

export function extractSampleSize(text: string): string | null {
  const patterns = [
    /\b(?:n|N)\s*=\s*([0-9][0-9,]*)\b/g,
    /\b([0-9][0-9,]*)\s+(?:patients|participants|subjects|adults|children|cases)\b/gi,
    /\benrolled\s+([0-9][0-9,]*)\b/gi,
    /\bsample\s+of\s+([0-9][0-9,]*)\b/gi,
  ];
  for (const rx of patterns) {
    for (const match of text.matchAll(rx)) {
      const n = Number((match[1] ?? '').replace(/,/g, ''));
      // Reject an implausibly small "sample size" (< 10): almost always a misparse
      // of a phase or trial-version number ("TRAILBLAZER-ALZ 4" → "n=4"), not a
      // real study population. Scan every match so a valid later count is not
      // shadowed by an early misparse.
      if (Number.isFinite(n) && n >= 10) return `n=${n}`;
    }
  }
  return null;
}

// A ratio estimate (OR/RR/HR) is implausible as an integer ≥ 10: real ratios are
// reported with a decimal (0.68, 1.21, 3.75). A bare integer like "150" or "65"
// is almost always a misparse — typically the English word "or" followed by a
// count ("stroke or 150 events"). Reject those, plus anything non-positive or
// absurdly large.
function isPlausibleRatio(value: string): boolean {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return false;
  if (Number.isInteger(n) && n >= 10) return false;
  return true;
}

// A 95% CI is valid only when it is a proper interval: two finite, positive
// bounds with the lower strictly below the upper. A reversed or degenerate pair
// is a misparse.
function isPlausibleInterval(range: string): boolean {
  const parts = range.split(/\s*(?:-|to|,|–|—)\s*/).map(Number);
  if (parts.length !== 2) return false;
  const [lo, hi] = parts;
  if (lo === undefined || hi === undefined) return false;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  return lo > 0 && hi > 0 && lo < hi;
}

// Ratio matchers capture the keyword (group 1) and the estimate (group 2) so we
// can reject the English word "or" (lowercase) masquerading as the OR
// abbreviation — the cause of phantom "odds ratio 150" / "odds ratio 65" rows.
const RATIO_PATTERNS: Array<{ label: string; rx: RegExp }> = [
  { label: 'odds ratio', rx: /\b(odds ratio|OR)\b\s*(?:=|of|:)?\s*([0-9]+(?:\.[0-9]+)?)/gi },
  { label: 'risk ratio', rx: /\b(risk ratio|relative risk|RR)\b\s*(?:=|of|:)?\s*([0-9]+(?:\.[0-9]+)?)/gi },
  { label: 'hazard ratio', rx: /\b(hazard ratio|HR)\b\s*(?:=|of|:)?\s*([0-9]+(?:\.[0-9]+)?)/gi },
];

// A two-letter ratio abbreviation must be UPPERCASE in the source. Lowercase
// "or" / "rr" / "hr" is ordinary prose, not a statistic.
function isLowercaseWordAbbrev(keyword: string): boolean {
  return /^(or|rr|hr)$/i.test(keyword) && keyword !== keyword.toUpperCase();
}

export function extractEffectValues(text: string): ExtractedEffectValue[] {
  const effects: ExtractedEffectValue[] = [];

  for (const { label, rx } of RATIO_PATTERNS) {
    for (const match of text.matchAll(rx)) {
      const keyword = match[1] ?? '';
      const value = clean(match[2] ?? '');
      if (!value || isLowercaseWordAbbrev(keyword) || !isPlausibleRatio(value)) continue;
      effects.push({ label, value, sourceText: clean(match[0]) });
    }
  }

  const ciRx = /\b95%\s*CI\s*[:(]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:-|to|,|–|—)\s*[0-9]+(?:\.[0-9]+)?)\)?/gi;
  for (const match of text.matchAll(ciRx)) {
    const value = clean(match[1] ?? '');
    if (!value || !isPlausibleInterval(value)) continue;
    effects.push({ label: 'confidence interval', value, sourceText: clean(match[0]) });
  }

  const pRx = /\bp\s*(?:=|<|>)\s*(0?\.[0-9]+)/gi;
  for (const match of text.matchAll(pRx)) {
    const value = clean(match[1] ?? '');
    const n = Number(value);
    if (!value || !Number.isFinite(n) || n <= 0 || n > 1) continue;
    effects.push({ label: 'p-value', value, sourceText: clean(match[0]) });
  }

  const seen = new Set<string>();
  return effects.filter((effect) => {
    const key = `${effect.label}:${effect.value}:${effect.sourceText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Bind each ratio to ITS OWN confidence interval and p-value by scanning only
// the window that follows the estimate (the same parenthetical / clause), so an
// HR from one study is never glued to a CI or p-value from another. Direction is
// inferred from the point estimate, hardened by the interval: an interval that
// excludes 1.0 confirms the direction; one that crosses 1.0 is 'no effect'.
const BOUND_RATIO_RX = /\b(hazard ratio|odds ratio|risk ratio|relative risk|HR|OR|RR)\b\s*(?:=|of|was|at|:|,)?\s*([0-9]+(?:\.[0-9]+)?)/gi;
const WINDOW_CI_RX = /95%?\s*CI[\s:(]*([0-9]+(?:\.[0-9]+)?)\s*(?:-|–|—|‑|to|,)\s*([0-9]+(?:\.[0-9]+)?)/i;
const WINDOW_P_RX = /\bp\s*(?:value\s+of\s+|[=<>])\s*(0?\.[0-9]+)/i;

function effectDirection(value: number, ci: [number, number] | null): BoundEffect['direction'] {
  if (ci && ci[0] < 1 && ci[1] > 1) return 'no effect'; // interval crosses unity
  if (value < 0.95) return 'reduction';
  if (value > 1.05) return 'increase';
  return 'no effect';
}

// Structured-abstract section labels (the Rust strip_html now emits "Results:")
// so effect sizes are read from where a study reports them — the Results,
// Findings, Outcomes, and Conclusions sections — not a Background or Methods
// mention of a different study's number.
const SECTION_LABEL_RX =
  /\b(background|objectives?|aims?|introduction|methods?|design|setting|participants|results?|findings?|outcomes?|conclusions?|interpretation|discussion)\s*:/gi;
const RESULT_SECTIONS = new Set([
  'result', 'results', 'finding', 'findings', 'outcome', 'outcomes', 'conclusion', 'conclusions', 'interpretation',
]);

/** The Results/Findings/Conclusions sections of a labelled abstract, or null
 *  when the text carries no recognised section labels. */
export function resultsSectionText(text: string): string | null {
  const matches = [...text.matchAll(SECTION_LABEL_RX)];
  if (matches.length === 0) return null;
  const segments: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const label = (matches[i]![1] ?? '').toLowerCase();
    const start = matches[i]!.index! + matches[i]![0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    if (RESULT_SECTIONS.has(label)) segments.push(text.slice(start, end).trim());
  }
  return segments.length > 0 ? segments.join(' ') : null;
}

export function extractBoundEffects(text: string): BoundEffect[] {
  // Prefer the results/conclusions sections when the abstract is labelled.
  const scope = resultsSectionText(text) ?? text;
  const out: BoundEffect[] = [];
  const seen = new Set<string>();
  BOUND_RATIO_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOUND_RATIO_RX.exec(scope)) !== null) {
    const measure = (m[1] ?? '').toUpperCase();
    const valueStr = m[2] ?? '';
    const value = Number(valueStr);
    // Reject the English word "or"/"rr"/"hr" in lowercase and implausible ratios.
    if (isLowercaseWordAbbrev(m[1] ?? '') || !isPlausibleRatio(valueStr)) continue;
    const window = scope.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const ciM = window.match(WINDOW_CI_RX);
    const lo = ciM ? Number(ciM[1]) : NaN;
    const hi = ciM ? Number(ciM[2]) : NaN;
    // A confidence interval must bracket its own point estimate. When the parsed
    // interval does not contain the value (e.g. "OR 2.08 (95% CI 2.88-3.77)"), the
    // CI was mis-bound to a different number in the abstract; treat it as no CI so
    // the garbled pair neither renders in prose nor enters the meta-analysis. A
    // small tolerance absorbs rounding in the reported bounds.
    const bracketsPoint = value >= lo * 0.98 && value <= hi * 1.02;
    const validCi = !!ciM && Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && lo < hi && bracketsPoint;
    // Keep the CI verbatim (source-faithful), use the parsed bounds for direction.
    const ciStr = validCi ? `${ciM![1]}-${ciM![2]}` : null;
    const ciNums: [number, number] | null = validCi ? [lo, hi] : null;
    const pM = window.match(WINDOW_P_RX);
    const key = `${measure}:${valueStr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      measure,
      value: valueStr,
      ci: ciStr,
      pValue: pM ? (pM[1] ?? null) : null,
      direction: effectDirection(value, ciNums),
      sourceText: clean(m[0] + (ciStr ? ` (95% CI ${ciStr})` : '')),
    });
  }
  return out;
}
