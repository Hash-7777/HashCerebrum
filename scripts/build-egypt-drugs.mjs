#!/usr/bin/env node
// Regenerates the Egyptian drug brand → active-ingredient map and the generic-name
// supplement used by the drug-interaction router.
//
// Source: karem505/egyptian-drug-database (GitHub), 25k medicines registered in
// Egypt with English/Arabic trade names and scientific composition. License CC0-1.0
// (public domain) — free to bundle, no attribution required.
//
//   node scripts/build-egypt-drugs.mjs
//
// Produces two committed artifacts under src/features/brain/swarm/:
//   egypt-drug-aliases.json  — { brandWord: [generic ingredient, …] }
//   egypt-generics.json      — sorted list of generic ingredient names
//
// EVERY mapping comes straight from the dataset. Rows without a scientific
// composition are skipped; nothing is invented — this is a drug-safety lexicon.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CSV_URL =
  'https://raw.githubusercontent.com/karem505/egyptian-drug-database/main/data/egyptian-drugs.csv';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'features', 'brain', 'swarm');
const OUT_ALIASES = join(OUT_DIR, 'egypt-drug-aliases.json');
const OUT_GENERICS = join(OUT_DIR, 'egypt-generics.json');

// Brand-name leading tokens that are packaging/formulation words, not a brand.
const BRAND_STOP = new Set([
  'the', 'and', 'for', 'with', 'new', 'oral', 'film', 'plus', 'forte', 'extra', 'retard',
  'syrup', 'cream', 'drops', 'tabs', 'tablet', 'tablets', 'caps', 'vial', 'amp', 'susp',
  'gel', 'sol', 'inj', 'baby', 'kids', 'cold', 'flu', 'pain', 'anti', 'super', 'ultra',
]);

// Ingredient tokens that are salts/vehicles, not a distinct drug to search on.
const INGREDIENT_STOP = new Set([
  'sodium', 'potassium', 'calcium', 'magnesium', 'chloride', 'sulfate', 'sulphate', 'acid',
  'water', 'oral', 'purified', 'hydrochloride', 'phosphate', 'citrate', 'acetate', 'oxide',
  'dihydrate', 'monohydrate', 'hydrate', 'base', 'free', 'anhydrous', 'solution',
]);

// A minimal CSV line splitter honouring double-quoted fields.
function splitCsv(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

// The base, searchable word of an ingredient component: its first alphabetic word,
// lower-cased. "DICLOFENAC POTASSIUM" → "diclofenac"; "CLAVULANIC ACID" → "clavulanic".
function baseIngredientWord(component) {
  const first = component.trim().toLowerCase().split(/[^a-z]+/).filter(Boolean)[0] ?? '';
  if (first.length < 4 || INGREDIENT_STOP.has(first)) return '';
  return first;
}

// Parse a scientific_name cell into base ingredient words. Combos split on '+';
// parenthetical synonyms ("PARACETAMOL(ACETAMINOPHEN)") yield BOTH names.
function parseIngredients(scientific) {
  const words = new Set();
  for (const part of scientific.split('+')) {
    // Split the parenthetical synonym out as its own component too.
    for (const piece of part.split(/[()]/)) {
      const w = baseIngredientWord(piece);
      if (w) words.add(w);
    }
  }
  return [...words];
}

const res = await fetch(CSV_URL);
if (!res.ok) throw new Error(`Egyptian drug CSV download failed: ${res.status} ${res.statusText}`);
const text = await res.text();
const lines = text.split(/\r?\n/).filter(Boolean);
const header = splitCsv(lines[0]).map((h) => h.trim());
const iBrand = header.indexOf('commercial_name_en');
const iSci = header.indexOf('scientific_name');
if (iBrand < 0 || iSci < 0) throw new Error(`unexpected CSV schema: ${header.join(',')}`);

const brandMap = new Map(); // brandWord -> Set(generic words)
const generics = new Set();

for (let i = 1; i < lines.length; i++) {
  const cols = splitCsv(lines[i]);
  const brand = (cols[iBrand] ?? '').trim();
  const scientific = (cols[iSci] ?? '').trim();
  if (!brand || !scientific) continue;

  const ingredients = parseIngredients(scientific);
  if (ingredients.length === 0) continue;
  ingredients.forEach((g) => generics.add(g));

  // Brand key = the first alphabetic word of the English trade name.
  const brandWord = brand.toLowerCase().split(/[^a-z]+/).filter(Boolean)[0] ?? '';
  if (brandWord.length < 4 || BRAND_STOP.has(brandWord)) continue;

  const set = brandMap.get(brandWord) ?? new Set();
  ingredients.forEach((g) => set.add(g));
  brandMap.set(brandWord, set);
}

if (brandMap.size < 3_000) throw new Error(`suspiciously small brand map: ${brandMap.size}`);
if (generics.size < 500) throw new Error(`suspiciously small generic set: ${generics.size}`);

// Serialise: aliases sorted by key, values sorted; generics sorted.
const aliases = {};
for (const key of [...brandMap.keys()].sort()) {
  aliases[key] = [...brandMap.get(key)].sort();
}
await writeFile(OUT_ALIASES, `${JSON.stringify(aliases)}\n`, 'utf8');
await writeFile(OUT_GENERICS, `${JSON.stringify([...generics].sort())}\n`, 'utf8');
console.log(`wrote ${Object.keys(aliases).length} brand aliases to ${OUT_ALIASES}`);
console.log(`wrote ${generics.size} generic names to ${OUT_GENERICS}`);
