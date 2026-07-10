#!/usr/bin/env node
// Regenerates the gene-symbol lexicon used to decide whether an ALL-CAPS token in
// a question is actually a gene.
//
// Source: HGNC (HUGO Gene Nomenclature Committee) complete set, the authoritative
// registry of approved human gene symbols. Public domain / CC0.
//
//   node scripts/build-gene-symbols.mjs
//
// Only `Approved` symbols are kept, and only those shaped like a symbol token
// (leading capital, 2-12 chars, capitals/digits/hyphen). Withdrawn and previous
// symbols are excluded: they add ~13k rarely-typed strings and pull ordinary
// abbreviations back into the lexicon.
//
// The output is committed. Re-run only to refresh against a newer HGNC release.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HGNC_URL =
  'https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'features',
  'brain',
  'swarm',
  'genetics',
  'gene-symbols.json',
);

// Symbol-shaped: starts with a capital, 2-12 chars, capitals/digits/hyphen only.
const SYMBOL_SHAPE = /^[A-Z][A-Z0-9-]{1,11}$/;

// Gene families that are named as a bare prefix in real questions ("the HLA region",
// "KIR haplotypes") but are not themselves approved symbols — only their members
// are (HLA-A, HLA-DRB1, KIR2DL1).
const FAMILY_TOKENS = ['HLA', 'KIR'];

const res = await fetch(HGNC_URL);
if (!res.ok) throw new Error(`HGNC download failed: ${res.status} ${res.statusText}`);
const tsv = await res.text();

const [header, ...rows] = tsv.split('\n');
const cols = header.split('\t');
const symbolAt = cols.indexOf('symbol');
const statusAt = cols.indexOf('status');
if (symbolAt < 0 || statusAt < 0) throw new Error('HGNC schema changed: missing symbol/status');

const symbols = new Set(FAMILY_TOKENS);
for (const row of rows) {
  if (!row.trim()) continue;
  const fields = row.split('\t');
  if (fields[statusAt] !== 'Approved') continue;
  const symbol = fields[symbolAt]?.trim();
  if (symbol && SYMBOL_SHAPE.test(symbol)) symbols.add(symbol);
}

if (symbols.size < 30_000) throw new Error(`suspiciously small lexicon: ${symbols.size}`);

const sorted = [...symbols].sort();
await writeFile(OUT, `${JSON.stringify(sorted)}\n`, 'utf8');
console.log(`wrote ${sorted.length} gene symbols to ${OUT}`);
