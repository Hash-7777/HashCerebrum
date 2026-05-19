// Agent registry — six-slot tuple. TypeScript enforces the cap.

import type { MAX_AGENTS } from './constants';

export type AgentId =
  | 'librarian'
  | 'trialist'
  | 'pharmacologist'
  | 'synthesizer'
  | 'citation'
  | 'critic';

// Maps to anatomical regions in modes/brain/regions.ts. Each agent
// claims one base region for its glow. Topic detection adds accents.
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

export interface AgentDef {
  id: AgentId;
  label: string;
  role: string;
  regionBinding: RegionId;
}

type Tuple<T, N extends number, A extends T[] = []> = A['length'] extends N
  ? A
  : Tuple<T, N, [...A, T]>;

export const AGENTS: Tuple<AgentDef, typeof MAX_AGENTS> = [
  {
    id: 'librarian',
    label: 'Librarian',
    role: 'PubMed / Europe PMC / OpenAlex literature search',
    regionBinding: 'hippocampus', // memory / recall
  },
  {
    id: 'trialist',
    label: 'Trialist',
    role: 'ClinicalTrials.gov queries, trial cohort analysis',
    regionBinding: 'frontal', // planning / executive
  },
  {
    id: 'pharmacologist',
    label: 'Pharmacologist',
    role: 'RxNorm / OpenFDA — drug interactions & safety',
    regionBinding: 'basal_ganglia', // neurochemistry
  },
  {
    id: 'synthesizer',
    label: 'Synthesizer',
    role: 'PICO / GRADE evidence synthesis drafts',
    regionBinding: 'parietal', // integration
  },
  {
    id: 'citation',
    label: 'Citation',
    role: 'BibTeX / CSL-JSON / source provenance',
    regionBinding: 'occipital', // recording / output
  },
  {
    id: 'critic',
    label: 'Critic',
    role: 'Evidence-hierarchy + hallucination check',
    regionBinding: 'amygdala', // skepticism / threat detection
  },
];
