// Agent roster — a six-slot tuple: one boss plus five topic specialists.
// TypeScript enforces the cap (a seventh entry is a compile error). The
// boss is the single agent the user talks to; it routes each message and
// delegates research to the relevant specialists, then synthesizes.

import type { MAX_AGENTS } from './constants';

export type AgentId =
  | 'boss'
  | 'pharmacology'
  | 'trials'
  | 'literature'
  | 'dentistry'
  | 'public_health';

// Maps to anatomical regions in modes/brain/regions.ts. Each agent claims
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
];
const SPECIALIST_TOOLS = ['rag_search', ...MEDICAL_TOOLS];

export const AGENTS: Tuple<AgentDef, typeof MAX_AGENTS> = [
  {
    id: 'boss',
    label: 'Boss',
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
    id: 'trials',
    label: 'Clinical trials',
    kind: 'specialist',
    specialty: 'Registered clinical trials, study cohorts, and trial outcomes.',
    topicHint: 'clinical trials, study design, cohorts, interventions, trial results',
    tools: SPECIALIST_TOOLS,
    regionBinding: 'parietal', // integration
  },
  {
    id: 'literature',
    label: 'Literature & evidence',
    kind: 'specialist',
    specialty: 'Peer-reviewed literature, systematic reviews, and evidence synthesis.',
    topicHint: 'published research, reviews, mechanisms, diagnosis, general medicine',
    tools: SPECIALIST_TOOLS,
    regionBinding: 'hippocampus', // memory / recall
  },
  {
    id: 'dentistry',
    label: 'Dentistry',
    kind: 'specialist',
    specialty: 'Oral health, dental conditions, and dental treatment evidence.',
    topicHint: 'teeth, gums, oral health, dental procedures, periodontics, orthodontics',
    tools: SPECIALIST_TOOLS,
    regionBinding: 'temporal', // sensory context
  },
  {
    id: 'public_health',
    label: 'Public health',
    kind: 'specialist',
    specialty: 'Epidemiology, prevention, vaccination, and population health.',
    topicHint: 'epidemiology, prevention, vaccines, screening, population health, outbreaks',
    tools: SPECIALIST_TOOLS,
    regionBinding: 'occipital', // wide-field overview
  },
];

export const BOSS_AGENT: AgentDef = AGENTS[0];
export const SPECIALIST_AGENTS: AgentDef[] = AGENTS.filter((agent) => agent.kind === 'specialist');

export function agentById(id: AgentId): AgentDef {
  const found = AGENTS.find((agent) => agent.id === id);
  if (!found) throw new Error(`Unknown agent id: ${id}`);
  return found;
}
