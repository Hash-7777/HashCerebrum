// Agent roster — a six-slot tuple: one boss plus five topic specialists.
// TypeScript enforces the cap (a seventh entry is a compile error). The
// boss is the single agent the user talks to; it routes each message and
// delegates research to the relevant specialists, then synthesizes.

import type { MAX_AGENTS } from './constants';

export type AgentId =
  | 'boss'
  | 'pharmacology'
  | 'drug_interactions'
  | 'clinical_research'
  | 'evidence_synthesis'
  | 'genetics';

// Maps to anatomical regions in features/brain/data/regions.ts. Each agent claims
// one base region for its glow. Topic detection adds accents.
export type RegionId =
  | 'frontal'
  | 'parietal'
  | 'temporal'
  | 'occipital'
  | 'cerebellum'
  | 'brainstem'
  | 'hippocampus'
  | 'amygdala'
  | 'thalamus'
  | 'basal_ganglia';

export type AgentKind = 'boss' | 'specialist';

export interface AgentDef {
  id: AgentId;
  label: string;
  kind: AgentKind;
  /** One-line description of what this agent covers. */
  specialty: string;
  /** Hint the boss uses when deciding which specialists a question needs. */
  topicHint: string;
  /** Tool names this agent may call. */
  tools: string[];
  regionBinding: RegionId;
}

type Tuple<T, N extends number, A extends T[] = []> = A['length'] extends N
  ? A
  : Tuple<T, N, [...A, T]>;

// The six guarded medical-source tools, plus project-memory retrieval.
const MEDICAL_TOOLS = [
  'pubmed_search',
  'europepmc_fetch',
  'openalex_query',
  'ctgov_search',
  'openfda_query',
  'rxnorm_lookup',
  'semantic_scholar_search',
];
const SPECIALIST_TOOLS = ['rag_search', ...MEDICAL_TOOLS];
// The gene-expert specialist leans on the curated genetic databases plus
// literature and project memory — not the full medical toolset.
const GENETICS_TOOLS = [
  'rag_search',
  'gwas_catalog_search',
  'clinvar_search',
  'pubmed_search',
  'europepmc_fetch',
  'openalex_query',
];

export const AGENTS: Tuple<AgentDef, typeof MAX_AGENTS> = [
  {
    id: 'boss',
    label: 'The Cerebrum',
    kind: 'boss',
    specialty:
      'Routes each question, delegates research to the relevant specialists, and synthesizes their findings into one cited answer.',
    topicHint: 'orchestration, routing, and synthesis',
    tools: ['rag_search'],
    regionBinding: 'frontal', // executive / planning
  },
  {
    id: 'pharmacology',
    label: 'Pharmacology',
    kind: 'specialist',
    specialty: 'Drugs, dosing, interactions, adverse effects, and drug safety.',
    topicHint: 'drugs, medications, dosage, side effects, interactions, toxicology',
    tools: SPECIALIST_TOOLS,
    regionBinding: 'basal_ganglia', // neurochemistry
  },
  {
    id: 'drug_interactions',
    label: 'Drug interactions',
    kind: 'specialist',
    specialty:
      'Drug-drug interactions, contraindications, adverse drug events, and pharmacokinetic conflicts sourced from FDA labels and peer-reviewed safety literature.',
    topicHint:
      'drug interactions, contraindications, adverse drug reactions, drug combinations, polypharmacy, toxicology, FDA drug events',
    tools: ['rag_search', 'openfda_query', 'rxnorm_lookup', 'pubmed_search', 'europepmc_fetch'],
    regionBinding: 'amygdala', // threat and alarm processing
  },
  {
    id: 'clinical_research',
    label: 'Clinical research',
    kind: 'specialist',
    specialty:
      'Registered clinical trials, study cohorts, trial outcomes, statistical analyses, effect sizes, confidence intervals, and quantitative figures from clinical and epidemiological literature.',
    topicHint:
      'clinical trials, study design, cohorts, interventions, trial results, statistics, data analysis, effect sizes, confidence intervals, p-values, sample size, hazard ratios, meta-analysis, figures, tables, quantitative results',
    tools: SPECIALIST_TOOLS,
    regionBinding: 'parietal', // integration
  },
  {
    id: 'evidence_synthesis',
    label: 'Evidence synthesis',
    kind: 'specialist',
    specialty:
      'Peer-reviewed literature, systematic reviews, evidence synthesis, epidemiology, prevention, vaccination, population health, and oral health.',
    topicHint:
      'published research, reviews, mechanisms, diagnosis, general medicine, epidemiology, prevention, vaccines, screening, population health, outbreaks, teeth, gums, oral health, dental procedures, periodontics, orthodontics',
    tools: SPECIALIST_TOOLS,
    regionBinding: 'hippocampus', // memory / recall
  },
  {
    id: 'genetics',
    label: 'Genetics',
    kind: 'specialist',
    specialty:
      'Gene/variant–disease associations from curated genetic databases (GWAS Catalog, ClinVar) and genetics literature, with quantitative effect sizes.',
    topicHint:
      'gene, variant, SNP, rsID, allele, genotype, polymorphism, mutation, GWAS, ClinVar, heritability, gene-disease association, pharmacogenomics',
    tools: GENETICS_TOOLS,
    regionBinding: 'cerebellum', // previously ambient; bound to the gene expert
  },
];

export const BOSS_AGENT: AgentDef = AGENTS[0];
export const SPECIALIST_AGENTS: AgentDef[] = AGENTS.filter((agent) => agent.kind === 'specialist');

export function agentById(id: AgentId): AgentDef {
  const found = AGENTS.find((agent) => agent.id === id);
  if (!found) throw new Error(`Unknown agent id: ${id}`);
  return found;
}

// The agent bound to a brain region, or undefined for ambient regions
// (cerebellum, brainstem) that no agent claims. Derived from AGENTS so the
// region tooltip can never drift out of sync with the roster.
export function agentForRegion(regionId: RegionId): AgentDef | undefined {
  return AGENTS.find((agent) => agent.regionBinding === regionId);
}
