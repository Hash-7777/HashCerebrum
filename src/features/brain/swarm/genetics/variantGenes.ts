// Variant / allele → gene resolution.
//
// The association engine scores BY gene symbol, but a user often names only the
// variant ("is the C677T variant linked to recurrent thrombosis", "does rs1801133
// raise VTE risk"). Without resolution such a question scored no gene at all. This
// module maps a named variant or rsID to the gene it belongs to so the query can be
// searched and scored against the correct gene, and cited to it.
//
// The mapping is a CURATED lookup of clinically established variants — a variant's
// gene cannot be inferred from its shape (C677T could belong to any gene), so this
// is deterministic vendored knowledge, never a guess. rsIDs and legacy protein/
// nucleotide substitution names are both covered. Genes here are canonical HGNC
// symbols so downstream membership checks succeed.

import { extractGeneSymbols, extractRsIds, extractVariantNotations } from './geneQueryReadiness';

// rsID (lower-case, without the "rs") → HGNC gene symbol.
const RSID_GENE: Record<string, string> = {
  rs1801133: 'MTHFR', // C677T
  rs1801131: 'MTHFR', // A1298C
  rs1799963: 'F2', // prothrombin G20210A
  rs6025: 'F5', // Factor V Leiden R506Q
  rs429358: 'APOE', // APOE ε
  rs7412: 'APOE', // APOE ε
  rs334: 'HBB', // sickle cell E6V (HbS)
  rs28897696: 'BRCA1',
  rs121913529: 'KRAS',
  rs113993960: 'CFTR', // F508del
  rs1799983: 'NOS3',
  rs4149056: 'SLCO1B1',
  rs9939609: 'FTO',
};

// Legacy substitution / named-allele → HGNC gene symbol. Keys are upper-cased at
// lookup, so case in the query does not matter.
const NAMED_ALLELE_GENE: Record<string, string> = {
  C677T: 'MTHFR',
  A1298C: 'MTHFR',
  G20210A: 'F2',
  R506Q: 'F5', // Factor V Leiden
  V600E: 'BRAF',
  E6V: 'HBB', // sickle cell
  E7V: 'HBB',
  GLU6VAL: 'HBB',
  F508DEL: 'CFTR',
  DELTAF508: 'CFTR',
  DELF508: 'CFTR',
  D1691G: 'F5',
};

// Well-known variant PHRASES that name a gene indirectly (not a symbol/rsID shape),
// matched as whole words so ordinary prose is untouched.
const NAMED_PHRASE_GENE: Array<{ rx: RegExp; gene: string }> = [
  { rx: /\bfactor\s+v\s+leiden\b/i, gene: 'F5' },
  { rx: /\bprothrombin\s+(?:gene\s+)?(?:mutation|variant|g20210a)\b/i, gene: 'F2' },
];

/** The gene an rsID or a legacy substitution notation belongs to, or null when the
 *  token is not a variant we can resolve. Deterministic curated lookup only. */
export function resolveVariantToGene(token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  const lowerRs = t.toLowerCase().replace(/^rs?/, 'rs');
  if (/^rs\d+$/.test(lowerRs) && RSID_GENE[lowerRs]) return RSID_GENE[lowerRs]!;
  const upper = t.toUpperCase();
  return NAMED_ALLELE_GENE[upper] ?? null;
}

/** Every gene implied by the variants / rsIDs / named phrases in the text,
 *  de-duplicated, order kept. Empty when nothing resolves. */
export function genesForVariants(text: string): string[] {
  const out: string[] = [];
  const push = (gene: string | null | undefined) => {
    if (gene && !out.includes(gene)) out.push(gene);
  };
  for (const rs of extractRsIds(text)) push(resolveVariantToGene(rs));
  for (const v of extractVariantNotations(text)) push(resolveVariantToGene(v));
  for (const { rx, gene } of NAMED_PHRASE_GENE) if (rx.test(text)) push(gene);
  return out;
}

/** The genes a question names — directly by symbol, or indirectly through a
 *  variant / rsID (C677T → MTHFR, rs6025 → F5) — de-duplicated, symbols first. */
export function genesForQuestion(question: string): string[] {
  const out = [...extractGeneSymbols(question)];
  for (const gene of genesForVariants(question)) if (!out.includes(gene)) out.push(gene);
  return out;
}
