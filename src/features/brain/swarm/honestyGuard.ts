// Deterministic honesty pass over a drafted manuscript's prose.
//
// HashCerebrum's niche is a local, private, and HONEST research tool, so an
// exported document must never assert something the pipeline did not actually
// do. Left to itself the language model drifts into:
//   • formal appraisals it never ran — "rated with low GRADE certainty",
//     "ROBINS-I highlighted…", "the AMSTAR-2 assessment identified…";
//   • methodology for a dataset that was never uploaded — "had a dataset been
//     provided, the pipeline would have…";
//   • over-confident conclusions unsupported by an abstract-only evidence base.
//
// This pass strips the false claims and softens the over-confidence, while
// carefully KEEPING the honest negations (e.g. "no formal risk-of-bias
// appraisal was applied"). Pure and deterministic — the honesty layer behaves
// identically offline, on Ollama, and on cloud models, and is unit-testable.

/** Split prose into sentences, keeping terminal punctuation. */
export function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? (text.trim() ? [text.trim()] : []);
}

// Dash class covering ASCII hyphen plus the dash variants the exporter emits —
// notably the U+2011 NON-BREAKING HYPHEN in "risk‑of‑bias", "very‑low", "ROBINS‑I"
// — so the appraisal patterns match the real document, not just ASCII text.
const DASH = '[\\u2010-\\u2015\\u2212-]';

// A clause that POSITIVELY asserts a formal appraisal/tool was applied. The
// pipeline runs no formal GRADE / risk-of-bias appraisal on the manuscript, so
// any such assertion is fabricated.
const APPRAISAL_CLAIM_RX = new RegExp(
  [
    `\\b(?:low|high|moderate|some|very[\\s\\u2010-\\u2015\\u2212-]low)\\s+(?:grade\\s+)?(?:certaint(?:y|ies)|grading)\\b`,
    `\\bgrade\\s+(?:certaint(?:y|ies)|ratings?|grading|assessment)\\b`,
    `\\blow\\s+grade\\b`,
    `\\brobins${DASH}?i\\b`,
    `\\bamstar${DASH}?\\s?2?\\b`,
    `\\bcochrane\\s+ro?b\\b`,
    `\\brisk${DASH}of${DASH}bias\\s+(?:assessment|ratings?|appraisal|tool|concerns?|domains?)\\b`,
    `["\\u2018\\u2019']\\s*some\\s+concerns\\s*["\\u2018\\u2019']`,
    `\\bsome\\s+concerns\\b`,
    `\\brated\\s+(?:with|as)\\s+(?:low|high|moderate)\\b`,
  ].join('|'),
  'i',
);

// …unless the same clause is explicitly stating the ABSENCE of such an
// appraisal, which is the honest, allowed framing.
const APPRAISAL_NEGATION_RX =
  /\b(?:no|without|absence of|lack(?:ed|ing)? of|not\s+(?:applied|performed|conducted|undertaken)|did\s+not|were\s+not|was\s+not|never\s+(?:applied|performed))\b/i;

// Counterfactual "if a dataset had been provided…" padding — the review used no
// uploaded dataset, so this hypothetical is noise that reads as fabricated method.
const COUNTERFACTUAL_DATASET_RX =
  /\bhad\s+a\s+dataset\s+been\s+(?:provided|uploaded|supplied)\b|\bif\s+a\s+dataset\s+had\s+been\b|\bwould\s+have\s+(?:recorded|applied|computed|run)\b.*\b(?:filename|row\s+count|dataset)\b/i;

/** Remove sentences that fabricate a formal appraisal that was never performed. */
export function stripFabricatedAppraisal(text: string): string {
  return rejoin(
    splitSentences(text).filter(
      (s) => !(APPRAISAL_CLAIM_RX.test(s) && !APPRAISAL_NEGATION_RX.test(s)),
    ),
  );
}

/** Remove counterfactual dataset-processing padding when no dataset was used. */
export function stripCounterfactualDataset(text: string): string {
  return rejoin(splitSentences(text).filter((s) => !COUNTERFACTUAL_DATASET_RX.test(s)));
}

// Search-yield counts the model invents — and contradicts itself on ("320
// records" in the abstract vs "159 entries" in the body; "strong=76, moderate=25,
// weak=57" summing to 158, not 320). The real counts live in the deterministic
// source-yield figure/table, so any in-prose total is removed. This targets only
// counts of RECORDS / ENTRIES / CITATIONS / a corpus and evidence-strength
// clusters — never study sample sizes ("8891 participants"), which are real data.
const SEARCH_YIELD_RX =
  /\b\d[\d,]*\s+(?:unique\s+)?(?:records|entries|citations|abstracts)\b|\b(?:corpus|pool)\s+of\s+\d[\d,]*\b|\b(?:strong|moderate|weak|context)\s*[=:]\s*\d+\b/i;

/** Remove prose assertions of an invented search-yield record count. */
export function stripSearchYieldCounts(text: string): string {
  return rejoin(splitSentences(text).filter((s) => !SEARCH_YIELD_RX.test(s)));
}

// Over-confident phrasings → calibrated, honest equivalents. Applied verbatim
// (case-insensitive) so a low-certainty, abstract-only synthesis never claims
// more confidence than the evidence supports.
const OVERCLAIM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bpermits?\s+a\s+confident\s+assertion\s+that\b/gi, 'supports a tentative conclusion that'],
  [/\bwe\s+can\s+confidently\s+(?:assert|conclude|state)\s+that\b/gi, 'the available evidence suggests that'],
  [/\ba\s+confident\s+assertion\s+that\b/gi, 'a tentative conclusion that'],
  [/\bconfidently\s+(?:assert|conclude|state)s?\b/gi, 'tentatively concludes'],
  [/\bdefinitively\s+(?:shows?|demonstrates?|proves?|establishes?)\b/gi, 'suggests'],
  [/\b(?:proves|proven)\s+that\b/gi, 'indicates that'],
];

export function softenOverclaims(text: string): string {
  let out = text;
  for (const [rx, replacement] of OVERCLAIM_REPLACEMENTS) out = out.replace(rx, replacement);
  return out;
}

// A 95% confidence interval immediately followed by a significance claim. We
// capture the two interval bounds and the p-value's operator + magnitude so the
// corrector can act ONLY on a genuine contradiction. Hyphen class covers the
// ASCII, en/em dash, and the U+2011 non-breaking hyphen models emit ("p‑value").
const CI_THEN_P_RX =
  /(95\s*%?\s*CI[\s:(]*([0-9]+(?:\.[0-9]+)?)\s*(?:-|–|—|‑|to|,)\s*([0-9]+(?:\.[0-9]+)?)\s*\)?)((?:[,;]?\s*(?:and\s+)?(?:a\s+)?p[\s‑-]*(?:value\s+of\s+|=\s*|<\s*|>\s*))(0?\.[0-9]+))/gi;

/**
 * Reconcile a statistical contradiction: an effect estimate whose 95% CI crosses
 * 1.0 (i.e. is NOT statistically significant) presented alongside a significant
 * p-value — the signature of a p-value scraped from a different study and glued
 * on. The CI is authoritative for significance, so the false p-claim is replaced
 * with an honest non-significance note. A CI that does not cross 1.0, or a p that
 * does not assert significance, is left untouched.
 */
export function reconcileCrossingCI(text: string): string {
  return text.replace(CI_THEN_P_RX, (full, ciPart: string, lo: string, hi: string, pPart: string, pValue: string) => {
    const l = Number(lo);
    const h = Number(hi);
    const crosses = Number.isFinite(l) && Number.isFinite(h) && l < 1 && h > 1;
    const claimsSignificance = !/>/.test(pPart) && Number(pValue) < 0.05;
    if (crosses && claimsSignificance) {
      return `${ciPart}, a non-significant result because the 95% CI crosses 1.0`;
    }
    return full;
  });
}

function rejoin(sentences: string[]): string {
  return sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:)])/g, '$1')
    .trim();
}

/** Full deterministic honesty pass over one block of manuscript prose. */
export function applyHonestyPass(text: string): string {
  if (!text) return text;
  return softenOverclaims(
    reconcileCrossingCI(stripSearchYieldCounts(stripCounterfactualDataset(stripFabricatedAppraisal(text)))),
  );
}
