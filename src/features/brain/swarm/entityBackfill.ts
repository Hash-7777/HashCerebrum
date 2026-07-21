// Entity-targeted retrieval for the paper path.
//
// The specialist agents choose their own search queries, so a weak or rate-
// limited model can pick poor queries that miss the literature the question is
// actually about. A comparative genetics question ("association of the MTHFR and
// F5 genes with recurrent VTE") retrieved anticoagulant-drug studies and ZERO
// gene-association papers, so the manuscript answered the wrong question.
//
// This pass runs a deterministic, entity-targeted search: for every gene the
// question names, it queries the literature for that gene together with the
// disease/outcome terms, guaranteeing the on-topic association literature enters
// the evidence pool regardless of what the model chose. It mirrors the landmark-
// trial and drug-interaction backfills — bounded, best-effort, and additive; the
// relevance ranking and de-duplication then let the on-topic records lead.

import { tools as toolRegistry } from '@core/tools/ToolRegistry';
import type { EvidenceItem, MedicalSourceResult } from '@platform/index';
import type { SpecialistResult, SwarmCallbacks } from './types';
import { diseaseTerms } from './genetics/geneQueryReadiness';
import { genesForQuestion } from './genetics/variantGenes';

// Words that describe the REQUEST or the review type, not the disease, so they
// never belong in a literature query.
const REVIEW_META = new Set([
  'evidence', 'review', 'reviews', 'comparing', 'compare', 'comparison', 'association', 'associations',
  'systematic', 'meta', 'analysis', 'analyses', 'paper', 'research', 'study', 'studies', 'risk',
  'effect', 'effects', 'size', 'sizes', 'confidence', 'interval', 'intervals', 'report', 'publication',
  'ready', 'full', 'write', 'give', 'assess', 'appraisal',
  // Request/framing verbs and generic genetics nouns that describe the ASK, not
  // the disease — they leaked into a scoped gene query ("whether variant modifies
  // simvastatin associated myopathy") and add nothing to retrieval.
  'whether', 'variant', 'variants', 'allele', 'alleles', 'modifies', 'modify', 'modifying',
  'assessment', 'assessments', 'evaluate', 'determine', 'polymorphism', 'polymorphisms',
]);

/** The disease/outcome phrase a literature query should carry — the question's
 *  medical content words, minus gene symbols (already excluded) and request or
 *  review-type words. Capped so the query stays a focused phrase. */
function isMetaOrFragment(word: string): boolean {
  // A leftover variant fragment ("521t" from "c.521T>C") always starts with a
  // digit — no disease term does — so it is dropped.
  if (/^\d/.test(word)) return true;
  // A hyphenated compound is meta if any of its segments is a request/framing
  // word: "per-variant" drops (variant), but "simvastatin-associated" is kept.
  return word.split('-').some((seg) => REVIEW_META.has(seg));
}

export function diseaseCoreFor(question: string): string {
  return diseaseTerms(question)
    .filter((word) => !isMetaOrFragment(word))
    .slice(0, 6)
    .join(' ')
    .trim();
}

// The clause that names a gene, so a multi-part question pairs each gene with
// ITS OWN sub-topic. A SGLT2-vs-GLP1 paper that also asked about SLCO1B1 built
// the query "SLCO1B1 inhibitors receptor agonists major" — it took the whole
// question's first disease words (the cardiovascular arm's) instead of the
// "simvastatin myopathy" clause that actually names SLCO1B1, so the gene was
// searched against the wrong topic and returned nothing on-point. Clauses are
// split on sentence and list-item boundaries (";", newline, ". "); the period
// inside a variant token ("c.521T>C") is never a boundary because it is not
// followed by a space.
function clauseNamingGene(question: string, gene: string): string | undefined {
  const clauses = question.split(/[;\n]+|\.\s+/);
  const geneRx = new RegExp(`\\b${gene.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return clauses.find((clause) => geneRx.test(clause));
}

/** The disease phrase to pair with one gene: the gene's own clause when the
 *  question names it there and that clause carries a disease/outcome term;
 *  otherwise the whole-question core (single-topic questions are unchanged). */
function diseaseCoreForGene(question: string, gene: string): string {
  const clause = clauseNamingGene(question, gene);
  if (clause) {
    const scoped = diseaseCoreFor(clause);
    if (scoped) return scoped;
  }
  return diseaseCoreFor(question);
}

/** The targeted queries for a genetics question: each named gene paired with the
 *  disease/outcome phrase from its own clause. Pure and deterministic so it is
 *  testable offline. */
export function entitySearchQueries(question: string): string[] {
  // Resolve variants/rsIDs to their gene too, so "rs1801133 and VTE" still retrieves
  // the MTHFR association literature rather than nothing.
  const genes = genesForQuestion(question);
  if (genes.length === 0) return [];
  const queries = genes
    .map((gene) => {
      const core = diseaseCoreForGene(question, gene);
      return core ? `${gene} ${core}` : '';
    })
    .filter(Boolean);
  return [...new Set(queries)];
}

/**
 * Fetch the on-topic association literature for every gene the question names, so
 * the manuscript is built from records that actually address the asked question.
 * Returns a synthetic specialist result (null when the question names no gene or
 * nothing was found), which the caller merges and de-duplicates with the rest.
 */
export async function backfillNamedEntityEvidence(
  question: string,
  callbacks: SwarmCallbacks,
  opts: { maxPerQuery?: number } = {},
): Promise<SpecialistResult | null> {
  const queries = entitySearchQueries(question);
  if (queries.length === 0) return null;
  const pubmed = toolRegistry.get('pubmed_search');
  const europepmc = toolRegistry.get('europepmc_fetch');
  if (!pubmed && !europepmc) return null;

  const maxPerQuery = opts.maxPerQuery ?? 8;
  const records: EvidenceItem[] = [];
  let toolCalls = 0;
  callbacks.onToolCall('genetics', `Gene-association literature: ${queries.join(' | ')}`);
  for (const query of queries) {
    for (const tool of [pubmed, europepmc]) {
      if (!tool) continue;
      try {
        const result = await tool.execute({ query, maxResults: maxPerQuery });
        toolCalls += 1;
        const recs = (result as MedicalSourceResult | undefined)?.results ?? [];
        records.push(...recs);
        callbacks.onToolResult('genetics', `gene: ${query}`, recs.length);
      } catch {
        /* best-effort — a failed fetch never breaks the paper run */
      }
    }
  }
  if (records.length === 0) return null;
  return {
    agentId: 'genetics',
    label: 'Gene-association literature',
    subQuery: `association evidence for ${queries.join('; ')}`,
    findings: '',
    evidence: records,
    toolCalls,
  };
}
