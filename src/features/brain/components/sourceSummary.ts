// Provenance summary for an answer's cited sources.
//
// Consolidates the trust signal a reader wants at a glance: how many source
// records the answer rests on and how many distinct databases they came from,
// with a per-database breakdown for the tooltip. Pure and deterministic so it is
// testable without the UI. Drives the "N sources · M databases" chip that sits
// alongside the cited-claim verification badge.

import type { EvidenceItem } from '@platform/index';

const SOURCE_LABELS: Record<string, string> = {
  pubmed: 'PubMed',
  europepmc: 'Europe PMC',
  openalex: 'OpenAlex',
  ctgov: 'ClinicalTrials.gov',
  openfda: 'openFDA',
  rxnorm: 'RxNorm',
  semantic_scholar: 'Semantic Scholar',
  gwas_catalog: 'GWAS Catalog',
  clinvar: 'ClinVar',
  library: 'Imported document',
};

export interface SourceSummary {
  records: number;
  databases: number;
  breakdown: Array<{ label: string; count: number }>;
}

/** Summarise the databases behind a set of cited records, most-productive first.
 *  Returns null when there are no citations, so the chip is simply not shown. */
export function summarizeSources(citations: EvidenceItem[] | undefined): SourceSummary | null {
  if (!citations || citations.length === 0) return null;
  const counts = new Map<string, number>();
  for (const c of citations) counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
  const breakdown = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ label: SOURCE_LABELS[source] ?? source, count }));
  return { records: citations.length, databases: counts.size, breakdown };
}
