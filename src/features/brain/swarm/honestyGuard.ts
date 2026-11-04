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

/** Split prose into sentences, keeping terminal punctuation. A period that is
 *  NOT followed by whitespace is an INTRA-TOKEN period, not a sentence end — a
 *  real sentence boundary in prose is always followed by a space or the end of
 *  the text. This protects decimals ("0.86" never becomes "0." + "86", which the
 *  rejoin step re-spaced into "0. 86"), domain names ("ClinicalTrials.gov" never
 *  becomes "ClinicalTrials. gov"), and abbreviations ("e.g.", "i.e.", "U.S.").
 *  The protected periods are substituted for a sentinel during segmentation and
 *  restored immediately after. */
export function splitSentences(text: string): string[] {
  const DOT = String.fromCharCode(0xe000); // private-use sentinel, restored below
  const guarded = text.replace(/(\S)\.(?=\S)/g, `$1${DOT}`);
  const parts = guarded.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? (guarded.trim() ? [guarded.trim()] : []);
  return parts.map((s) => s.split(DOT).join('.'));
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

// A specific appraisal VERDICT the pipeline never produced — "some concerns",
// "low certainty", "rated as low". This is distinct from merely NAMING a tool: an
// honest negation ("no GRADE appraisal was applied") names the tool but asserts
// no verdict, and must be kept.
const APPRAISAL_VERDICT_RX = new RegExp(
  [
    `["\\u2018\\u2019']\\s*some\\s+concerns\\s*["\\u2018\\u2019']`,
    `\\brating\\s+of\\s+["\\u2018\\u2019']?\\s*some\\s+concerns`,
    `\\bas\\s+["\\u2018\\u2019']?\\s*some\\s+concerns`,
    `(?:low|moderate|high|very[\\s\\u2010-\\u2015\\u2212-]low)\\s+(?:grade\\s+)?certaint(?:y|ies)`,
    `certainty\\s+of\\s+evidence\\s+as\\s+(?:low|moderate|high)`,
    `rated\\s+(?:with|as)\\s+(?:low|moderate|high)`,
  ].join('|'),
  'i',
);

// A reference to a formal appraisal tool or a quality judgement. Naming one is
// honest; naming one alongside a VERDICT (above) is the fabrication.
const APPRAISAL_TOOL_RX = new RegExp(
  `\\bamstar${DASH}?\\s?2?\\b|\\bgrade\\b|\\brobins${DASH}?i\\b|\\bcochrane\\s+ro?b\\b|methodological\\s+quality|certainty\\s+of\\s+evidence|quality\\s+indicator`,
  'i',
);

/** Excise only the CLAUSES of a sentence that assert a fabricated verdict, keeping
 *  honest negation clauses in the same sentence. This also removes any internal
 *  source id that rides inside the fabricated clause (e.g. "… in S1"). The comma
 *  or semicolon stays attached to the preceding clause, so dropping a clause never
 *  leaves a dangling connector; a terminal period is restored if the dropped
 *  clause carried it. */
function dropFabricatedVerdictClauses(sentence: string): string {
  const clauses = sentence.split(/(?<=[;,])\s+/);
  const kept = clauses.filter((c) => !(APPRAISAL_TOOL_RX.test(c) && APPRAISAL_VERDICT_RX.test(c)));
  if (kept.length === clauses.length) return sentence;
  let joined = kept.join(' ').replace(/\s+([.,;:)])/g, '$1').trim();
  joined = joined.replace(/[,;\s]+$/, '');
  if (joined && !/[.!?]$/.test(joined)) joined += '.';
  return joined;
}

/** Remove fabricated formal-appraisal claims. A sentence that ONLY asserts a
 *  fabricated appraisal (no honest negation) is dropped whole; a compound sentence
 *  that carries an honest negation AND a fabricated verdict — which the old
 *  whole-sentence negation exemption let through intact — has only the fabricated
 *  verdict clause excised. */
export function stripFabricatedAppraisal(text: string): string {
  return rejoin(
    splitSentences(text)
      .filter((s) => !(APPRAISAL_CLAIM_RX.test(s) && !APPRAISAL_NEGATION_RX.test(s)))
      .map((s) =>
        APPRAISAL_TOOL_RX.test(s) && APPRAISAL_VERDICT_RX.test(s)
          ? dropFabricatedVerdictClauses(s)
          : s,
      )
      .filter(Boolean),
  );
}

/** Remove counterfactual dataset-processing padding when no dataset was used. */
export function stripCounterfactualDataset(text: string): string {
  return rejoin(splitSentences(text).filter((s) => !COUNTERFACTUAL_DATASET_RX.test(s)));
}

// A bracketed token that is NOT a citation marker — [S3], [3], [S1, S2],
// [S1-S9] — is pipeline scaffolding or a model placeholder ("[guideline context
// inferred]", "[citation needed]", "[insert reference]") that must never ship in
// the prose. We remove only MULTI-WORD non-marker brackets, so a single-token
// bracket that is real notation (an isotope label like [18F] or [11C]) is kept.
const CITATION_MARKER_INNER = /^\s*S?\d+(?:\s*[,;&–—-]\s*S?\d+)*\s*$/i;

/**
 * The same removal for a Markdown answer: placeholder brackets go, citation
 * markers, single-token brackets and link text ("[text](url)") stay, and line
 * breaks are kept so headings and lists survive. Dashes left dangling where a
 * bracket stood are tidied with it.
 */
export function stripPlaceholderBrackets(markdown: string): string {
  return markdown
    .replace(/[ \t]*\[([^\]\n]*)\](?!\()([ \t]*[—–]{1,2}(?=[ \t]))?/g, (full, inner: string) => {
      const trimmed = inner.trim();
      if (/^claim-/i.test(trimmed)) return '';
      if (CITATION_MARKER_INNER.test(inner)) return full;
      if (/\s/.test(trimmed)) return '';
      return full;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:)])/g, '$1');
}

/** Remove scaffolding/placeholder brackets while keeping real [S#] citations. */
export function stripNonSourceBrackets(text: string): string {
  return text
    .replace(/\[([^\]]*)\]/g, (full, inner: string) => {
      const trimmed = inner.trim();
      // An internal ledger id ("claim-3") that leaked from the claim ledger into
      // reader prose — never a citation, drop it. It has no whitespace, so the
      // single-token rule below would otherwise keep it.
      if (/^claim-/i.test(trimmed)) return '';
      if (CITATION_MARKER_INNER.test(inner)) return full; // a real citation marker
      if (/\s/.test(trimmed)) return ''; // multi-word → placeholder, drop it
      return full; // single token (e.g. [18F]) — leave alone
    })
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:)])/g, '$1')
    .trim();
}

// Search-yield counts the model invents — and contradicts itself on ("320
// records" in the abstract vs "159 entries" in the body; "202 unique
// publications" vs "69 structured evidence items" vs the deterministic 60;
// "strong=76, moderate=25, weak=57" summing to 158, not 320). The real counts
// live in the deterministic source-yield figure/table, so any in-prose total is
// removed. This targets only counts of RECORDS / ENTRIES / CITATIONS /
// PUBLICATIONS / a corpus and evidence-strength clusters — never study sample
// sizes ("8891 participants"), which are real data, and never a narrated study
// count like "three studies reported…".
const SEARCH_YIELD_RX =
  /\b\d[\d,]*\s+(?:unique\s+)?(?:records|entries|citations|abstracts|publications|structured\s+evidence\s+items|evidence\s+items)\b|\b(?:corpus|pool)\s+of\s+\d[\d,]*\b|\b(?:strong|moderate|weak|context)\s*[=:]\s*\d+\b/i;

/** Remove prose assertions of an invented search-yield record count. */
export function stripSearchYieldCounts(text: string): string {
  return rejoin(splitSentences(text).filter((s) => !SEARCH_YIELD_RX.test(s)));
}

// A fabricated AGGREGATE across the corpus that the pipeline never computes: a
// "pooled / combined / total sample size of N participants" (the pipeline runs no
// meta-analytic pooling of sample sizes, so any such total is invented — in one
// real run the abstract claimed "a pooled sample size of 270 participants" while
// the body cited single studies of 617,611), or an invented evidence-strength
// breakdown ("29 strong, 52 moderate, 17 weak … sources"). A single study's own
// sample size ("a cohort of 617,611 patients") is real data and is NOT matched.
const FABRICATED_AGGREGATE_RX =
  /\b(?:pooled|combined|aggregate|total|overall|cumulative)\s+(?:sample(?:\s+size)?|cohort|population|enrol[lm]ent)\s+of\s+\d[\d,]*\s*(?:participants|patients|subjects|individuals|cases)\b|\b\d+\s+strong\b[^.]*?\b\d+\s+moderate\b[^.]*?\b\d+\s+(?:weak|context)/i;

/** Remove sentences asserting a fabricated pooled participant count or an
 *  invented evidence-strength breakdown. */
export function stripFabricatedAggregates(text: string): string {
  return rejoin(splitSentences(text).filter((s) => !FABRICATED_AGGREGATE_RX.test(s)));
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

// A directional verb that contradicts the ratio it modifies — "reduced … HR 1.4"
// or "increased … HR 0.6" — is a recombined or mis-narrated estimate (an HR > 1
// is an increase, an HR < 1 a reduction). The ratio is the data, so the
// contradictory verb is softened to a neutral association. The window stops at
// clause boundaries (no comma/semicolon) so a ratio belonging to a different
// clause cannot trigger a false correction.
const DIRECTION_RX =
  /\b(reduc(?:ed|es|tion)|lower(?:ed|s|ing)?|decreas(?:ed|es|ing)|increas(?:ed|es|ing)|rais(?:ed|es|ing)|elevat(?:ed|es))\b([^.,;]{0,45}?\b(?:hazard ratio|odds ratio|risk ratio|relative risk|HR|OR|RR)\b\s*(?:=|of|was|at|:|,)?\s*)([0-9]+(?:\.[0-9]+)?)/gi;
const BENEFIT_VERB_RX = /^(?:reduc|lower|decreas)/i;
const HARM_VERB_RX = /^(?:increas|rais|elevat)/i;

export function reconcileDirection(text: string): string {
  return text.replace(DIRECTION_RX, (full, verb: string, middle: string, valueStr: string) => {
    const value = Number(valueStr);
    if (!Number.isFinite(value)) return full;
    const contradiction =
      (BENEFIT_VERB_RX.test(verb) && value >= 1.1) || (HARM_VERB_RX.test(verb) && value <= 0.9);
    return contradiction ? `was associated with${middle}${valueStr}` : full;
  });
}

// A direction/magnitude claim that spans more prose than the tight adjacency
// window above can safely reach — "diabetes doubles the risk of ASCVD, as
// reflected by a hazard ratio of 0.89" (a doubling is a ratio near 2, not 0.89),
// or "reduced mortality … relative risk of 1.4". The tight pass stops at the
// first comma, so a claim separated from its ratio by a clause escapes it. This
// pass works one SENTENCE at a time and, crucially, acts only when the sentence
// carries exactly ONE effect ratio and its directional claims all point the same
// way — so a ratio that belongs to a different clause can never be mis-corrected.
const RATIO_LABEL = '(?:hazard ratio|odds ratio|risk ratio|relative risk|HR|OR|RR)';
const RATIO_VALUE_RX = new RegExp(
  `\\b${RATIO_LABEL}\\b\\s*(?:=|of|was|at|:|,)?\\s*([0-9]+(?:\\.[0-9]+)?)`,
  'gi',
);
// Words asserting the effect got BIGGER (a ratio ≥ ~1) vs SMALLER (≤ ~1). Kept to
// unambiguous verbs — "higher"/"greater" are adjectives whose grammar an in-place
// rewrite would break, so they are deliberately excluded here.
const INCREASE_WORDS = 'increas(?:e|es|ed|ing)|rais(?:e|es|ed|ing)|elevat(?:e|es|ed|ing)|doubl(?:e|es|ed|ing)|tripl(?:e|es|ed|ing)|quadrupl(?:e|es|ed|ing)|augment(?:s|ed|ing)?';
const DECREASE_WORDS = 'reduc(?:e|es|ed|ing|tion)|decreas(?:e|es|ed|ing)|halv(?:e|es|ed|ing)|lower(?:s|ed|ing)|diminish(?:es|ed|ing)?';
const INCREASE_ANY_RX = new RegExp(`\\b(?:${INCREASE_WORDS})\\b`, 'i');
const DECREASE_ANY_RX = new RegExp(`\\b(?:${DECREASE_WORDS})\\b`, 'i');
// The span from a directional word THROUGH its ratio — replaced wholesale with a
// neutral association so the misleading direction is dropped and the ratio kept.
const DIRECTION_SPAN_RX = new RegExp(
  `\\b(?:${INCREASE_WORDS}|${DECREASE_WORDS})\\b.*?(${RATIO_LABEL})\\s*(?:=|of|was|at|:|,)?\\s*([0-9]+(?:\\.[0-9]+)?)`,
  'i',
);

export function reconcileSentenceDirection(text: string): string {
  return rejoin(
    splitSentences(text).map((sentence) => {
      const ratios = [...sentence.matchAll(RATIO_VALUE_RX)];
      if (ratios.length !== 1) return sentence; // none, or too many to attribute
      const value = Number(ratios[0]?.[1]);
      if (!Number.isFinite(value)) return sentence;
      const hasIncrease = INCREASE_ANY_RX.test(sentence);
      const hasDecrease = DECREASE_ANY_RX.test(sentence);
      if (hasIncrease && hasDecrease) return sentence; // mixed claims — do not touch
      const contradiction = (hasIncrease && value <= 0.9) || (hasDecrease && value >= 1.1);
      if (!contradiction) return sentence;
      return sentence.replace(
        DIRECTION_SPAN_RX,
        (_full, label: string, val: string) => `was associated with a ${label} of ${val}`,
      );
    }),
  );
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
    reconcileSentenceDirection(
      reconcileDirection(
        reconcileCrossingCI(
          stripFabricatedAggregates(
            stripSearchYieldCounts(
              stripCounterfactualDataset(stripFabricatedAppraisal(stripNonSourceBrackets(text))),
            ),
          ),
        ),
      ),
    ),
  );
}
