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
import { extractGeneSymbols, diseaseTerms } from './genetics/geneQueryReadiness';

// Words that describe the REQUEST or the review type, not the disease, so they
// never belong in a literature query.
const REVIEW_META = new Set([
  'evidence', 'review', 'reviews', 'comparing', 'compare', 'comparison', 'association', 'associations',
  'systematic', 'meta', 'analysis', 'analyses', 'paper', 'research', 'study', 'studies', 'risk',
  'effect', 'effects', 'size', 'sizes', 'confidence', 'interval', 'intervals', 'report', 'publication',
  'ready', 'full', 'write', 'give', 'assess', 'appraisal',
]);

/** The disease/outcome phrase a literature query should carry — the question's
 *  medical content words, minus gene symbols (already excluded) and request or
 *  review-type words. Capped so the query stays a focused phrase. */
export function diseaseCoreFor(question: string): string {
  return diseaseTerms(question)
    .filter((word) => !REVIEW_META.has(word))
    .slice(0, 6)
    .join(' ')
    .trim();
}

/** The targeted queries for a genetics question: each named gene paired with the
 *  disease/outcome phrase. Pure and deterministic so it is testable offline. */
export function entitySearchQueries(question: string): string[] {
  const genes = extractGeneSymbols(question);
  const core = diseaseCoreFor(question);
  if (genes.length === 0 || !core) return [];
  return [...new Set(genes.map((gene) => `${gene} ${core}`))];
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
