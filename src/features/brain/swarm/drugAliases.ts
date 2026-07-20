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
import { LEXICON_STOPWORDS } from './drugLexiconStopwords';

// A chunk of the Egyptian registry's brand keys are ordinary English words that
// are NOT themselves a generic ingredient — "Confident" (a peppermint/rosemary
// herbal), "Effect", "Safe", "Value", "Sleep". Left in, isDrugAlias() flags them
// as drugs, so a question like "…how confident I can be…" parses "confident" as a
// drug and the real drug is dropped from the interaction pair. Drop these keys at
// load so every consumer of the map ignores them uniformly. A brand key that IS a
// real RxNorm ingredient (aspirin, caffeine) is not in this list and is kept.
const egyptAliases: Record<string, string[]> = Object.fromEntries(
  Object.entries(EGYPT_ALIASES as Record<string, string[]>).filter(
    ([key]) => !LEXICON_STOPWORDS.has(key.toLowerCase()),
  ),
);

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

/** A deterministic representative for an ingredient and its INN/US spelling
 *  synonyms, so "paracetamol" and "acetaminophen" collapse to one name. Chosen as
 *  the alphabetically-first of the token and its known synonyms. */
function canonicalGeneric(name: string): string {
  const lower = name.toLowerCase();
  return [lower, ...genericsFor(lower).map((g) => g.toLowerCase())].sort()[0]!;
}

/**
 * The single active ingredient a token denotes, or null when the token is a
 * combination product or a brand FAMILY that spans several ingredients (Panadol's
 * registry entry unions paracetamol, caffeine, aspirin…). A plain generic stands
 * for itself. INN/US spelling pairs of the same drug collapse to one ingredient, so
 * a two-name brand like Tylenol (acetaminophen/paracetamol) is still mono-ingredient.
 */
export function monoIngredient(token: string): string | null {
  const lower = token.toLowerCase();
  const generics = genericsFor(lower);
  if (generics.length === 0) return lower; // a generic ingredient (or unknown) stands for itself
  const canon = new Set(generics.map(canonicalGeneric));
  return canon.size === 1 ? [...canon][0]! : null; // a real combination/family has no single ingredient
}

/** Do two tokens name the SAME active ingredient (brand "similars")? Catafast,
 *  Cataflam and Voltaren are all diclofenac; paracetamol and acetaminophen are one
 *  drug. A combination/family brand never asserts sameness (returns false), so the
 *  answer is only positive when both tokens are confidently mono-ingredient. */
export function sameActiveIngredient(a: string, b: string): boolean {
  const ma = monoIngredient(a);
  return ma !== null && ma === monoIngredient(b);
}

/** The single generic name a token should be searched or referred to under — its
 *  one active ingredient when it has one, else the first ingredient of a
 *  combination, else the token itself. Deterministic. */
export function primaryGeneric(token: string): string {
  return monoIngredient(token) ?? genericsFor(token)[0] ?? token.toLowerCase();
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
