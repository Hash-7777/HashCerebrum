#!/usr/bin/env node
// Regenerates the drug-lexicon stopword list.
//
// The vendored Egyptian data — the brand→generic map (egypt-drug-aliases.json) and
// the generic list (egypt-generics.json) — carry entries that are ordinary English
// words rather than drugs: "Confident" (a peppermint/rosemary herbal brand),
// "Effect", "Safe", "Value", and even bare fillers like "each", "with", "high",
// "active". Left in, drugCandidates() treats them as drugs, so a question like
// "…how confident I can be that each association…" parses "confident" and "each" as
// drugs and the real drug is dropped from the interaction pair.
//
// This script emits every alias/generic key that is a common English word AND is
// NOT a clean RxNorm ingredient (drug-names.json). RxNorm is authoritative and
// clean, so a token present there (iron, zinc, calcium, aspirin, caffeine) is a
// real drug and is KEPT; only the English-word entries absent from RxNorm are
// dropped. The list is consumed by drugAliases.ts (filters the brand map) and
// boss.ts (filters knownDrugs), so both lexicons ignore the collisions uniformly.
//
//   node scripts/build-drug-alias-stopwords.mjs [path-to-wordlist]
//
// The wordlist defaults to the system dictionary (/usr/share/dict/words), which
// omits some ultra-common function words, so a small COMMON_EXTRA set is unioned
// in. The output is committed; re-run only to refresh against newer data.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SWARM = join(HERE, '..', 'src', 'features', 'brain', 'swarm');
const WORDLIST = process.argv[2] ?? '/usr/share/dict/words';

// Ultra-common English words the web2 dictionary omits but which appear in
// questions and collide with registry keys.
const COMMON_EXTRA = [
  'each', 'with', 'also', 'real', 'very', 'most', 'some', 'give', 'that', 'this', 'when', 'only',
  'from', 'into', 'such', 'than', 'then', 'over', 'both', 'been', 'were', 'will', 'have', 'they',
  'them', 'here', 'what', 'does', 'take', 'same', 'well', 'good', 'many', 'much', 'need', 'used',
  'make', 'made', 'like', 'main', 'flag', 'plan', 'watch',
];

async function loadJson(name) {
  return JSON.parse(await readFile(join(SWARM, name), 'utf8'));
}

const [aliases, drugNames, egyptGenerics, wordsRaw] = await Promise.all([
  loadJson('egypt-drug-aliases.json'),
  loadJson('drug-names.json'),
  loadJson('egypt-generics.json'),
  readFile(WORDLIST, 'utf8'),
]);

const rxnorm = new Set(drugNames.map((w) => String(w).toLowerCase()));
const english = new Set([
  ...wordsRaw.split('\n').map((w) => w.trim().toLowerCase()),
  ...COMMON_EXTRA,
]);

const keys = new Set([
  ...Object.keys(aliases).map((k) => k.toLowerCase()),
  ...egyptGenerics.map((g) => String(g).toLowerCase()),
]);

const stopwords = [...keys]
  .filter((k) => k.length >= 4 && english.has(k) && !rxnorm.has(k))
  .sort();

await writeFile(join(SWARM, 'drug-lexicon-stopwords.json'), `${JSON.stringify(stopwords, null, 0)}\n`);
console.log(`Wrote ${stopwords.length} drug-lexicon stopwords.`);
