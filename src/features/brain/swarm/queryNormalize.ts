// Spelling normalization for the research question.
//
// A misspelled subject term (the user typed "anticouagulant") used to cascade
// through the whole pipeline: the literal token never appeared in any retrieved
// record, so the concept-coverage gate declared an "absolute evidence gap" and
// the manuscript was built around a gap that did not exist — every section
// opening with "the retrieved records contain NO direct evidence". The typo also
// leaked into the title and keywords ("Anticouagulant").
//
// This module repairs common biomedical misspellings BEFORE the question is used
// for search, concept coverage, the title and the keywords. It is deliberately
// conservative — an explicit typo map (high precision) plus a distance-1 fuzzy
// pass against a small lexicon of frequently-mistyped drug and condition names —
// so a correctly-spelled term is never "corrected" into a different one.

// Explicit, high-confidence corrections. Keyed by the lowercased token; the
// replacement preserves the canonical spelling. These are exact misspellings we
// have actually seen or that are one obvious transposition away from a term that
// matters for retrieval and concept matching.
const SPELLING_FIXES: Record<string, string> = {
  // anticoagulant family — the bug that motivated this module
  anticouagulant: 'anticoagulant',
  anticouagulants: 'anticoagulants',
  anticoagulent: 'anticoagulant',
  anticoagulents: 'anticoagulants',
  anticoaglant: 'anticoagulant',
  anticoagulnt: 'anticoagulant',
  anticoagualtion: 'anticoagulation',
  anticoagualant: 'anticoagulant',
  // common condition misspellings
  diabetis: 'diabetes',
  diabetese: 'diabetes',
  diabets: 'diabetes',
  hypertention: 'hypertension',
  hypertenssion: 'hypertension',
  cholestrol: 'cholesterol',
  arthimia: 'arrhythmia',
  arrythmia: 'arrhythmia',
  arrhythmias: 'arrhythmia',
  alzheimers: 'alzheimer',
  parkinsons: 'parkinson',
  // common drug misspellings
  metaformin: 'metformin',
  ibuprofin: 'ibuprofen',
  ibruprofen: 'ibuprofen',
  acetominophen: 'acetaminophen',
  paracetomol: 'paracetamol',
  warfrin: 'warfarin',
  wafarin: 'warfarin',
  rivaroxiban: 'rivaroxaban',
  apixiban: 'apixaban',
  clopidogrol: 'clopidogrel',
  atorvastin: 'atorvastatin',
  lisinpril: 'lisinopril',
  amoxicilin: 'amoxicillin',
  sertaline: 'sertraline',
  tramodol: 'tramadol',
};

// Frequently-mistyped canonical terms used by the distance-1 fuzzy pass. Kept
// short and high-value: a term here corrects a one-character typo even when it
// is not in the explicit map above. Anything not close to one of these is left
// untouched, so this never rewrites an unrelated word.
const FUZZY_LEXICON: readonly string[] = [
  'anticoagulant',
  'anticoagulants',
  'anticoagulation',
  'antiplatelet',
  'antidiabetic',
  'antihypertensive',
  'diabetes',
  'diabetic',
  'hypertension',
  'cholesterol',
  'arrhythmia',
  'fibrillation',
  'thrombosis',
  'embolism',
  'metformin',
  'ibuprofen',
  'acetaminophen',
  'paracetamol',
  'warfarin',
  'rivaroxaban',
  'apixaban',
  'edoxaban',
  'dabigatran',
  'clopidogrel',
  'atorvastatin',
  'simvastatin',
  'lisinopril',
  'hydrochlorothiazide',
  'amoxicillin',
  'sertraline',
  'tramadol',
];

const LEXICON_SET = new Set(FUZZY_LEXICON);

// Levenshtein distance with early exit once the running minimum exceeds 1 — we
// only ever care whether two words are a single edit apart.
function withinEditDistance1(a: string, b: string): boolean {
  if (a === b) return false; // identical is not a "correction"
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  // Walk both strings, allowing exactly one substitution/insertion/deletion.
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (la === lb) {
      i += 1;
      j += 1; // substitution
    } else if (la > lb) {
      i += 1; // deletion from a
    } else {
      j += 1; // insertion into a
    }
  }
  if (i < la || j < lb) edits += 1; // trailing unmatched char
  return edits === 1;
}

function correctWord(lower: string): string | null {
  const explicit = SPELLING_FIXES[lower];
  if (explicit) return explicit;
  // Already a known-good term — never touch it.
  if (LEXICON_SET.has(lower)) return null;
  // Fuzzy pass only for longer tokens, to keep precision high (short words have
  // too many distance-1 neighbours to correct safely).
  if (lower.length < 7) return null;
  for (const term of FUZZY_LEXICON) {
    if (withinEditDistance1(lower, term)) return term;
  }
  return null;
}

// Re-apply the original token's capitalization shape to the correction so a
// sentence-leading "Anticouagulant" stays capitalized as "Anticoagulant".
function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Repair common biomedical misspellings in a free-text question. Splits on
 * whitespace, normalizes each word's alphabetic core while preserving its
 * surrounding punctuation and capitalization, and rejoins. Pure and
 * deterministic.
 */
export function normalizeMedicalSpelling(text: string): string {
  return text
    .split(/(\s+)/) // keep the whitespace separators so spacing is preserved
    .map((token) => {
      if (/^\s+$/.test(token) || token === '') return token;
      const match = token.match(/^([^A-Za-z]*)([A-Za-z][A-Za-z'-]*)([^A-Za-z]*)$/);
      if (!match) return token;
      const [, lead, core, trail] = match;
      const corrected = correctWord(core!.toLowerCase());
      if (!corrected) return token;
      return `${lead}${matchCase(core!, corrected)}${trail}`;
    })
    .join('');
}
