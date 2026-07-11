// Drug brand → generic (active-ingredient) aliases.
//
// The interaction router needs to recognise the drugs a question names and then
// find real interaction evidence for them. Two gaps broke that for everyday
// questions: regional / over-the-counter BRAND names (Panadol, Catafast) are not
// RxNorm ingredients, and the RxNorm export is US-centric (the INN "paracetamol"
// is absent though "acetaminophen" is present).
//
// The bulk of the map is the vendored Egyptian drug registry (25k medicines,
// CC0-1.0) built by scripts/build-egypt-drugs.mjs → egypt-drug-aliases.json, so a
// brand a user types resolves to its active ingredient straight from a real
// dataset — nothing is guessed, which is what a drug-safety lexicon requires. A
// small hand-curated supplement adds common international brands the Egyptian set
// does not carry and generic↔generic synonyms (INN vs US spelling).

import EGYPT_ALIASES from './egypt-drug-aliases.json';

const egyptAliases = EGYPT_ALIASES as Record<string, string[]>;

// International brands / generic synonyms not covered by the Egyptian registry.
const SUPPLEMENT: Record<string, string[]> = {
  // Generic ↔ generic (INN vs US spelling)
  paracetamol: ['acetaminophen'],
  acetaminophen: ['paracetamol'],
  salbutamol: ['albuterol'],
  albuterol: ['salbutamol'],
  adrenaline: ['epinephrine'],
  epinephrine: ['adrenaline'],
  frusemide: ['furosemide'],
  furosemide: ['frusemide'],
  glibenclamide: ['glyburide'],
  glyburide: ['glibenclamide'],
  rifampicin: ['rifampin'],
  // Common international brands
  tylenol: ['acetaminophen', 'paracetamol'],
  advil: ['ibuprofen'],
  motrin: ['ibuprofen'],
  aleve: ['naproxen'],
  coumadin: ['warfarin'],
  plavix: ['clopidogrel'],
  eliquis: ['apixaban'],
  xarelto: ['rivaroxaban'],
  nexium: ['esomeprazole'],
  zithromax: ['azithromycin'],
};

let aliasKeys: Set<string> | null = null;

/** Is this token a known brand or aliased generic the map can resolve? */
export function isDrugAlias(token: string): boolean {
  aliasKeys ??= new Set([...Object.keys(egyptAliases), ...Object.keys(SUPPLEMENT)]);
  return aliasKeys.has(token.toLowerCase());
}

/** Generic ingredient name(s) for a brand/alias, or [] when unknown. */
export function genericsFor(token: string): string[] {
  const lower = token.toLowerCase();
  const egypt = egyptAliases[lower] ?? [];
  const extra = SUPPLEMENT[lower] ?? [];
  return extra.length > 0 ? [...new Set([...egypt, ...extra])] : egypt;
}

/**
 * Every generic name a token stands for, INCLUDING the token itself — so a brand
 * ("catafast") is treated as verified when its generic ("diclofenac") appears in
 * the evidence, and a search can look for both.
 */
export function drugSynonyms(token: string): string[] {
  const lower = token.toLowerCase();
  return [lower, ...genericsFor(lower)];
}

/**
 * Append the generic ingredient names for any brand the question mentions, so the
 * interaction search retrieves real literature ("panadol and catafast" also
 * searches "paracetamol"/"acetaminophen" and "diclofenac"). Returns the question
 * unchanged when it names no known brand.
 */
export function expandDrugQuery(question: string): string {
  const lowerQuestion = question.toLowerCase();
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const raw of lowerQuestion.split(/[^a-z0-9]+/)) {
    for (const generic of genericsFor(raw)) {
      if (lowerQuestion.includes(generic) || seen.has(generic)) continue;
      seen.add(generic);
      extra.push(generic);
    }
  }
  return extra.length > 0 ? `${question} (${extra.join(', ')})` : question;
}
