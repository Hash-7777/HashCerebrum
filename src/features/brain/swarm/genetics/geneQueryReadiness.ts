// Clarify-before-answer gate for Genetics mode.
//
// Before the gene-expert agent searches, it checks the conversation actually
// names BOTH a gene/variant and a disease/phenotype. When something is missing
// it asks the user a targeted question first (like a planning conversation)
// rather than guessing. Pure and deterministic so it works on any model,
// including small local ones — the clarifying questions are fixed templates.

// Approved human gene symbols (HGNC). Regenerate with scripts/build-gene-symbols.mjs.
// A token only reads as a gene when it appears HERE — an ALL-CAPS shape alone is not
// enough. Trial acronyms (TOPCAT, SPRINT, EMPEROR) and reporting guidelines (PRISMA,
// CONSORT, STROBE) are ALL-CAPS and are not genes; treating them as genes routed a
// spironolactone-in-HFpEF question to the gene expert.
import GENE_SYMBOLS from './gene-symbols.json';

export interface GeneQueryReadiness {
  ready: boolean;
  hasGene: boolean;
  hasDisease: boolean;
  /** Targeted questions to ask when not ready (empty when ready). */
  questions: string[];
}

const RS_RX = /\brs\d{2,}\b/i;

let lexicon: Set<string> | null = null;
function geneLexicon(): Set<string> {
  lexicon ??= new Set(GENE_SYMBOLS as readonly string[]);
  return lexicon;
}

// Upper-case tokens that look like a gene symbol but are common non-gene
// abbreviations — excluded so they don't read as a gene.
const NON_GENE_CAPS = new Set([
  'AND', 'THE', 'FOR', 'NOT', 'BUT', 'WITH', 'DNA', 'RNA', 'PCR', 'FDA', 'EMA', 'WHO', 'BMI',
  'WBC', 'HB', 'MRI', 'CT', 'ICU', 'OR', 'NK', 'ID', 'T1D', 'T2D', 'CVD', 'CV', 'HBA1C',
]);

// Approved gene symbols that are ALSO routine clinical, dosing or statistical
// abbreviations. "ACE inhibitor", "CAD", "elevated CRP", "BID dosing" are not
// genetics, so a bare occurrence of these is not a gene signal — the question must
// carry explicit genetic context as well. Unambiguous symbols (MICA, KRAS, BRCA1,
// APOE) never need this, so a bare "MICA and type 1 diabetes" still routes to the
// gene expert.
const AMBIGUOUS_SYMBOLS = new Set([
  'ACE', 'ACHE', 'ADA', 'ALB', 'BID', 'CAD', 'CAMP', 'CAST', 'CAT', 'CELL', 'CLOCK', 'CRP',
  'EGFR', 'FAT', 'GAS', 'IDE', 'IMPACT', 'LAD', 'LARGE', 'MET', 'MICE', 'NUMB', 'PACE', 'PAP',
  'PER', 'PLAT', 'PRUNE', 'RAGE', 'REST', 'SAT', 'SEA', 'SET', 'SKI', 'SLUG', 'SPIN', 'STAR',
  'TAT', 'TAX', 'VIP',
]);

// Explicit genetic framing that rescues an ambiguous symbol.
const GENETIC_CONTEXT_RX =
  /\b(gene|genes|genetic|genetics|genomic|genome|variant|variants|allele|alleles|genotype|genotypes|polymorphism|polymorphisms|mutation|mutations|snp|snps|rs\d{2,}|locus|loci|haplotype|haplotypes|gwas|clinvar|germline|somatic|epigenetic|methylation|promoter|knockout|wild-?type|expression|amplification|fusion|rearrangement|pharmacogenomic|pharmacogenetics?)\b/i;

// Words that describe the kind of finding or are generic — never the disease.
const NON_DISEASE_WORDS = new Set([
  'gene', 'genes', 'variant', 'variants', 'polymorphism', 'polymorphisms', 'mutation', 'mutations',
  'allele', 'alleles', 'genotype', 'genotypes', 'association', 'associations', 'correlation',
  'correlations', 'variation', 'variations', 'snp', 'snps', 'effect', 'effects', 'impact', 'role',
  'risk', 'between', 'with', 'and', 'the', 'for', 'does', 'what', 'which', 'have', 'has', 'are',
  'this', 'that', 'about', 'into', 'from', 'their', 'them', 'patient', 'patients', 'people',
  'disease', 'diseases', 'condition', 'conditions', 'phenotype', 'phenotypes', 'expression',
  'analyze', 'analyse', 'show', 'tell', 'find', 'give', 'report', 'correlate', 'associated',
]);

/** Shaped like a gene symbol: ALL-CAPS, 2-12 chars. Shape ONLY — says nothing about
 *  whether the token is a real gene. Used to keep acronyms out of the disease terms. */
function geneLikeToken(token: string): boolean {
  const t = token.trim();
  const len = t.length;
  if (len < 2 || len > 12) return false;
  if (NON_GENE_CAPS.has(t)) return false;
  if (!/^[A-Z][A-Z0-9-]*$/.test(t)) return false; // ALL-CAPS gene-style token
  // A 2-letter all-caps token is too ambiguous unless it carries a digit.
  if (len === 2 && !/\d/.test(t)) return false;
  return /[A-Z]/.test(t);
}

/** Is this token an actual approved gene symbol, given the surrounding question?
 *  Shape + HGNC membership; an ambiguous symbol additionally needs genetic context. */
function isGeneSymbolToken(token: string, text: string): boolean {
  const t = token.trim();
  if (!geneLikeToken(t)) return false;
  if (!geneLexicon().has(t)) return false;
  if (AMBIGUOUS_SYMBOLS.has(t) && !GENETIC_CONTEXT_RX.test(text)) return false;
  return true;
}

/** Is this exact token an approved HGNC gene symbol (case-insensitive)? Used to
 *  keep gene symbols from being mistaken for trial acronyms. */
export function isApprovedGeneSymbol(token: string): boolean {
  return geneLexicon().has(token.trim().toUpperCase());
}

/** Does the text name a gene symbol or an rsID? */
export function hasGeneSignal(text: string): boolean {
  if (RS_RX.test(text)) return true;
  return text.split(/[^A-Za-z0-9-]+/).some((tok) => isGeneSymbolToken(tok, text));
}

/** Gene-symbol tokens named in the text (e.g. "MICA"), de-duplicated, order kept.
 *  Used to query GWAS Catalog / ClinVar by SYMBOL rather than by a whole sentence,
 *  which those APIs cannot match. */
export function extractGeneSymbols(text: string): string[] {
  const out: string[] = [];
  for (const tok of text.split(/[^A-Za-z0-9-]+/)) {
    const t = tok.trim();
    if (isGeneSymbolToken(t, text) && !out.includes(t)) out.push(t);
  }
  return out;
}

// A gene-shaped token presented AS a gene: immediately next to a gene noun
// ("the ZXPQ7 gene", "the MTHFR, ACE, and ZndR4 genes", "variant BRAF", "APOE
// allele"). The gene noun may be singular or plural. The adjacency is what keeps
// ordinary terms (MACE, SGLT2, LDL) from being mistaken for a claimed gene — only
// a token the user frames as a gene is captured. The token pattern is deliberately
// case-tolerant so a sloppily typed made-up symbol like "ZndR4" is still caught;
// the real filtering (symbol shape, HGNC membership) happens in claimedGeneShape.
const GENE_NOUN = '(?:genes?|variants?|alleles?|polymorphisms?|mutations?|genotypes?|loci|locus)';
const CLAIMED_GENE_RX = new RegExp(
  `\\b([A-Za-z][A-Za-z0-9-]{1,11})\\s+${GENE_NOUN}\\b|\\b${GENE_NOUN}\\s+([A-Za-z][A-Za-z0-9-]{1,11})\\b`,
  'g',
);

/** Shaped like a gene SYMBOL a user might type — tolerant of mixed case ("ZndR4")
 *  and invented strings. It must carry a digit or be written all-caps, so an
 *  ordinary word placed next to a gene noun ("candidate genes", "disease variants",
 *  "Warfarin gene") is excluded. Shape ONLY; HGNC membership is checked separately. */
function claimedGeneShape(token: string): boolean {
  const t = token.trim();
  if (t.length < 2 || t.length > 12) return false;
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(t)) return false;
  const hasDigit = /\d/.test(t);
  const allCaps = /^[A-Z][A-Z0-9-]*$/.test(t);
  if (!hasDigit && !allCaps) return false; // a plain word, not a symbol
  // A 2-char all-caps token with no digit is too ambiguous (ID, OR, NK…).
  if (allCaps && !hasDigit && t.length === 2) return false;
  return true;
}

/**
 * Gene-shaped tokens the question presents as genes but that are NOT approved
 * HGNC symbols (e.g. a made-up "ZXPQ7 gene" or "ZndR4 genes"). The report must
 * name these as unrecognized and refuse to score them, never fold them under a
 * real gene's confidence. Recognized symbols (in any case) and rsIDs are excluded.
 */
export function extractUnrecognizedGeneTokens(text: string): string[] {
  const recognized = new Set(extractGeneSymbols(text));
  const out: string[] = [];
  for (const m of text.matchAll(CLAIMED_GENE_RX)) {
    const token = (m[1] ?? m[2] ?? '').trim();
    if (!token) continue;
    if (!claimedGeneShape(token)) continue; // must look like a symbol, not a word
    const upper = token.toUpperCase();
    if (geneLexicon().has(upper)) continue; // a real approved symbol (any case)
    if (NON_GENE_CAPS.has(upper)) continue; // routine non-gene abbreviation
    if (recognized.has(token)) continue;
    if (NON_DISEASE_WORDS.has(token.toLowerCase())) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

/** rsID tokens named in the text (e.g. "rs1051792"), de-duplicated. */
export function extractRsIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\brs\d{2,}\b/gi)) {
    const id = m[0].toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The disease/phenotype content words in a query (lowercased) — excluding gene
 *  symbols, rsIDs and genetics meta-words. Used to keep literature scoring on
 *  the asked disease. */
export function diseaseTerms(text: string): string[] {
  const out: string[] = [];
  for (const tok of text.split(/[^A-Za-z0-9-]+/)) {
    const original = tok.trim();
    const word = original.toLowerCase();
    if (word.length < 4 || !/[a-z]/.test(word)) continue;
    if (NON_DISEASE_WORDS.has(word)) continue;
    if (geneLikeToken(original) || RS_RX.test(original)) continue;
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

/** Does the text name a disease/phenotype (a topical content word)? */
export function hasDiseaseSignal(text: string, gene?: string): boolean {
  return text.split(/[^A-Za-z0-9-]+/).some((tok) => {
    const original = tok.trim();
    const word = original.toLowerCase();
    if (word.length < 4 || !/[a-z]/.test(word)) return false;
    if (NON_DISEASE_WORDS.has(word)) return false;
    if (gene && word === gene.toLowerCase()) return false;
    // A gene symbol or rsID is not a disease, even when it isn't the named gene.
    if (geneLikeToken(original) || RS_RX.test(original)) return false;
    return true;
  });
}

const ASK_GENE =
  'Which gene or variant should I look at? You can give a gene symbol (e.g. MICA) or an rsID (e.g. rs1051792).';
const ASK_DISEASE = 'Which disease or phenotype should I check the association against?';

/**
 * Assess whether a (whole-conversation) genetics query is ready to answer.
 * `text` should be the combined user turns plus the current question.
 */
export function assessGeneQueryReadiness(text: string): GeneQueryReadiness {
  const hasGene = hasGeneSignal(text);
  const hasDisease = hasDiseaseSignal(text);
  const questions: string[] = [];
  if (!hasGene) questions.push(ASK_GENE);
  if (!hasDisease) questions.push(ASK_DISEASE);
  return { ready: hasGene && hasDisease, hasGene, hasDisease, questions };
}

/** The chat message the agent posts when it needs more before answering. */
export function clarificationMessage(readiness: GeneQueryReadiness): string {
  const intro =
    'Before I search the genetic databases, I need a bit more so the result is grounded in the right records:';
  const bullets = readiness.questions.map((q) => `- ${q}`).join('\n');
  return `${intro}\n\n${bullets}`;
}

/**
 * The chat message the agent posts when a research or paper request names a
 * gene-shaped token that is not an approved HGNC symbol. Rather than draft a
 * manuscript that silently folds a borrowed effect size onto a gene that may not
 * exist, ask the author to confirm or correct the symbol first.
 */
export function unrecognizedGeneMessage(symbols: string[]): string {
  const list = symbols.join(', ');
  const plural = symbols.length > 1;
  const it = plural ? 'they' : 'it';
  const them = plural ? 'them' : 'it';
  return (
    `Before I research this, I want to check one thing so the paper stays trustworthy: ` +
    `${list} ${plural ? 'do not match' : 'does not match'} any approved human gene symbol (HGNC). ` +
    `If ${it} really ${plural ? 'are' : 'is'} not ${plural ? 'genes' : 'a gene'}, I would end up attaching numbers from other studies to ${them}.\n\n` +
    `Could you tell me which you mean:\n` +
    `- A typo for a real gene symbol — reply with the correct one (for example MTHFR, F5, or SERPINC1).\n` +
    `- Not a gene — reply "drop ${them}" and I will continue with only the recognized genes.`
  );
}
