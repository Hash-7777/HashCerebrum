// Agent roster: one boss plus four topic specialists. TypeScript enforces the
// MAX_AGENTS cap (an entry past it is a compile error). The boss is the single
// agent the user talks to; it routes each message and delegates research to the
// relevant specialists, then synthesizes.

import type { MAX_AGENTS } from './constants';

export type AgentId =
  | 'boss'
  | 'pharmacist'
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
  tools: readonly string[];
  regionBinding: RegionId;
}

// A roster of at most N entries. The same shape as the mode registry's cap.
type AtMost<T extends readonly unknown[], N extends number, A extends readonly unknown[] = []> =
  A['length'] extends N
    ? T extends readonly [] ? T : never
    : T extends readonly [unknown, ...infer Rest]
      ? AtMost<Rest, N, [...A, unknown]>
      : T;

const defineRoster = <const T extends readonly AgentDef[]>(
  roster: T & (AtMost<T, typeof MAX_AGENTS> extends never ? never : unknown),
) => roster;

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
// The literature specialists do not get the drug-label and drug-name sources:
// those answer drug questions, which belong to the Pharmacist, and a literature
// agent that reaches for them on a clinical question spends calls on records it
// cannot use.
const LITERATURE_TOOLS = SPECIALIST_TOOLS.filter((tool) => tool !== 'openfda_query' && tool !== 'rxnorm_lookup');
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

export const AGENTS = defineRoster([
  {
    id: 'boss',
    label: 'HashCerebrum',
    kind: 'boss',
    specialty:
      'Routes each question, delegates research to the relevant specialists, and synthesizes their findings into one cited answer.',
    topicHint: 'orchestration, routing, and synthesis',
    tools: ['rag_search'],
    regionBinding: 'frontal', // executive / planning
  },
  {
    // The one drug expert: general pharmacology AND drug–drug interactions. A
    // research run delegates medication questions to it, and a drug-interaction
    // question runs it alone, so both light the same region and the same row
    // of the agent panel.
    id: 'pharmacist',
    label: 'Pharmacist',
    kind: 'specialist',
    specialty:
      'Drugs, dosing, pharmacokinetics, pharmacodynamics, adverse effects and drug safety, plus drug–drug, drug–food, and drug–herb interactions and contraindications.',
    topicHint:
      'drugs, medications, dosage, pharmacokinetics, pharmacodynamics, side effects, adverse effects, toxicology, drug interactions, contraindications, drug combinations, polypharmacy',
    tools: SPECIALIST_TOOLS,
    regionBinding: 'basal_ganglia', // neurochemistry
  },
  {
    id: 'clinical_research',
    label: 'Clinical research',
    kind: 'specialist',
    specialty:
      'Registered clinical trials, study cohorts, trial outcomes, statistical analyses, effect sizes, confidence intervals, and quantitative figures from clinical and epidemiological literature.',
    topicHint:
      'clinical trials, study design, cohorts, interventions, trial results, statistics, data analysis, effect sizes, confidence intervals, p-values, sample size, hazard ratios, meta-analysis, figures, tables, quantitative results',
    tools: LITERATURE_TOOLS,
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
    tools: LITERATURE_TOOLS,
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
]);

export const BOSS_AGENT: AgentDef = AGENTS[0];
export const SPECIALIST_AGENTS: AgentDef[] = AGENTS.filter((agent) => agent.kind === 'specialist');

// The specialist pool the boss plans across and the agent panel lists: every
// specialist, so whatever runs is always on the panel.
export const BRAIN_SPECIALIST_AGENTS: AgentDef[] = SPECIALIST_AGENTS;
export const BRAIN_AGENTS: AgentDef[] = [BOSS_AGENT, ...BRAIN_SPECIALIST_AGENTS];

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
