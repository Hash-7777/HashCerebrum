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

// A clause that POSITIVELY asserts a formal appraisal/tool was applied. The
// pipeline runs no formal GRADE / risk-of-bias appraisal on the manuscript, so
// any such assertion is fabricated.
const APPRAISAL_CLAIM_RX =
  /\b(?:low|high|moderate|very[- ]low)\s+grade\s+(?:certainty|rating)\b|\bgrade\s+(?:certainty|rating|assessment)\b|\brobins-?i\b|\bamstar-?\s?2?\b|\bcochrane\s+ro?b\b|\brisk[- ]of[- ]bias\s+(?:assessment|rating|appraisal|tool|domains?)\b|\bflagged\s+(?:for|with)\s+["']?some\s+concerns\b|\brated\s+(?:with|as)\s+(?:low|high|moderate|very[- ]low)\b/i;

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
  return softenOverclaims(stripCounterfactualDataset(stripFabricatedAppraisal(text)));
}
