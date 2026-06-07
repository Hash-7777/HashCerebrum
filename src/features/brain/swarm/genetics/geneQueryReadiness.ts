// Clarify-before-answer gate for Genetics mode.
//
// Before the gene-expert agent searches, it checks the conversation actually
// names BOTH a gene/variant and a disease/phenotype. When something is missing
// it asks the user a targeted question first (like a planning conversation)
// rather than guessing. Pure and deterministic so it works on any model,
// including small local ones — the clarifying questions are fixed templates.

export interface GeneQueryReadiness {
  ready: boolean;
  hasGene: boolean;
  hasDisease: boolean;
  /** Targeted questions to ask when not ready (empty when ready). */
  questions: string[];
}

const RS_RX = /\brs\d{2,}\b/i;

// Upper-case tokens that look like a gene symbol but are common non-gene
// abbreviations — excluded so they don't read as a gene.
const NON_GENE_CAPS = new Set([
  'AND', 'THE', 'FOR', 'NOT', 'BUT', 'WITH', 'DNA', 'RNA', 'PCR', 'FDA', 'EMA', 'WHO', 'BMI',
  'WBC', 'HB', 'MRI', 'CT', 'ICU', 'OR', 'NK', 'ID', 'T1D', 'T2D', 'CVD', 'CV', 'HBA1C',
]);

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

/** Does the text name a gene symbol or an rsID? */
export function hasGeneSignal(text: string): boolean {
  if (RS_RX.test(text)) return true;
  return text.split(/[^A-Za-z0-9-]+/).some(geneLikeToken);
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
