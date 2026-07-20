// Shared drug-lexicon stopword set.
//
// The vendored Egyptian data (the brand→generic map and the generic list) carry
// entries that are ordinary English words rather than drugs — "Confident" (a
// herbal brand), "Effect", "Safe", plus bare fillers like "each", "with", "high",
// "active". These made drugCandidates() parse everyday words as drugs, so a real
// interaction ("simvastatin … Klacid") lost its drugs to noise ("statin … each").
//
// This set is every alias/generic key that is a common English word AND is not a
// clean RxNorm ingredient, so real drugs (aspirin, iron, zinc, caffeine) are kept
// and only the English-word collisions are dropped. Consumed by drugAliases.ts
// (filters the brand map) and boss.ts (filters knownDrugs). Regenerate the JSON
// with scripts/build-drug-alias-stopwords.mjs.

import STOPWORDS from './drug-lexicon-stopwords.json';

export const LEXICON_STOPWORDS: ReadonlySet<string> = new Set(
  (STOPWORDS as readonly string[]).map((word) => word.toLowerCase()),
);
