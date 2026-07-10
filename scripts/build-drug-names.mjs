#!/usr/bin/env node
// Regenerates the drug-name lexicon used to decide whether a word in a question is
// actually a drug.
//
// Source: RxNorm (US National Library of Medicine), the reference terminology for
// clinical drugs. Public domain. Concept types requested:
//   IN  — ingredient        (clopidogrel, warfarin)
//   PIN — precise ingredient (esomeprazole magnesium)
//   BN  — brand name         (Plavix, Eliquis)
//
//   node scripts/build-drug-names.mjs
//
// Only single-word alphabetic names of 4+ characters are kept: the caller matches one
// token at a time, so multi-word names ("insulin glargine") would never match, and
// their component words ("sodium", "acid") would flag ordinary prose as drugs.
//
// The output is committed. Re-run only to refresh against a newer RxNorm release.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RXNAV_URL = 'https://rxnav.nlm.nih.gov/REST/allconcepts.json?tty=IN+PIN+BN';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'features',
  'brain',
  'swarm',
  'drug-names.json',
);

const SINGLE_WORD = /^[a-z][a-z-]{3,}$/;

const res = await fetch(RXNAV_URL);
if (!res.ok) throw new Error(`RxNav download failed: ${res.status} ${res.statusText}`);
const body = await res.json();

const concepts = body?.minConceptGroup?.minConcept;
if (!Array.isArray(concepts)) throw new Error('RxNav schema changed: minConceptGroup.minConcept missing');

const names = new Set();
for (const concept of concepts) {
  const name = String(concept.name ?? '').toLowerCase().trim();
  if (SINGLE_WORD.test(name)) names.add(name);
}

if (names.size < 5_000) throw new Error(`suspiciously small drug lexicon: ${names.size}`);

const sorted = [...names].sort();
await writeFile(OUT, `${JSON.stringify(sorted)}\n`, 'utf8');
console.log(`wrote ${sorted.length} drug names to ${OUT}`);
