// Which anatomical region each medical source lights up, and which specialist
// owns it.
//
// This is the domain half of the source table. The presentation half — labels,
// icons, and the IPC tool name — stays in the Brain feature's `data/sources.ts`,
// which derives its `agentId` and `region` fields from here so there is exactly
// one source of truth.
//
// It lives in config because two features need it and neither owns it: the
// Brain workspace lights a region when a tool runs, and the Memory graph lights
// one when you hover a saved finding. Keeping it inside the Brain feature is
// what forced Memory to import across a feature boundary.

import type { AgentId, RegionId } from './agents';

export interface SourceDomain {
  agentId: AgentId;
  region: RegionId;
}

/** Keyed by `EvidenceItem['source']`. Typed loosely here so config does not
 *  depend on the platform module; the Brain source table pins the exact ids. */
export const SOURCE_DOMAIN: Record<string, SourceDomain> = {
  pubmed: { agentId: 'evidence_synthesis', region: 'hippocampus' },
  europepmc: { agentId: 'evidence_synthesis', region: 'hippocampus' },
  openalex: { agentId: 'evidence_synthesis', region: 'hippocampus' },
  semantic_scholar: { agentId: 'evidence_synthesis', region: 'hippocampus' },
  library: { agentId: 'evidence_synthesis', region: 'hippocampus' },
  ctgov: { agentId: 'clinical_research', region: 'parietal' },
  openfda: { agentId: 'pharmacist', region: 'basal_ganglia' },
  rxnorm: { agentId: 'pharmacist', region: 'basal_ganglia' },
  gwas_catalog: { agentId: 'genetics', region: 'cerebellum' },
  clinvar: { agentId: 'genetics', region: 'cerebellum' },
};

/** Synthesized answers are executive output — they map to the frontal region. */
export const ANSWER_REGION: RegionId = 'frontal';

/** The region a source lights, falling back to the answer region for anything
 *  not in the table (an imported document, a future source). */
export function regionForSource(source: string): RegionId {
  return SOURCE_DOMAIN[source]?.region ?? ANSWER_REGION;
}
