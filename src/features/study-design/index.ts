// Interactive Study-Design Forms and GRADE Evidence Profiles.
// Provides machine-readable CONSORT, PRISMA, STROBE, RoB 2, and Newcastle-Ottawa
// forms plus GRADE evidence-profile tables.

export type StudyDesignType = 'consort' | 'prisma' | 'strobe' | 'rob2' | 'newcastle';

export interface FormField {
  id: string;
  label: string;
  type: 'boolean' | 'text' | 'number' | 'select';
  options?: string[];
  required: boolean;
  section: string;
}

export interface FormResponse {
  design: StudyDesignType;
  fields: Record<string, string | boolean | number>;
  completedAt: string;
}

export interface GradeOutcome {
  outcome: string;
  studies: number;
  certainty: 'high' | 'moderate' | 'low' | 'very-low';
  riskOfBias: 'not-serious' | 'serious' | 'very-serious';
  inconsistency: 'not-serious' | 'serious' | 'very-serious';
  indirectness: 'not-serious' | 'serious' | 'very-serious';
  imprecision: 'not-serious' | 'serious' | 'very-serious';
  publicationBias: 'not-serious' | 'serious' | 'very-serious';
  effectEstimate: string;
  relativeEffect?: string;
  absoluteEffect?: string;
}

const CONSORT_FIELDS: FormField[] = [
  { id: 'c-randomised', label: 'Participants randomised?', type: 'boolean', required: true, section: 'Methods' },
  { id: 'c-alloc-conceal', label: 'Allocation concealment used?', type: 'boolean', required: true, section: 'Methods' },
  { id: 'c-blinding-pat', label: 'Patient blinding?', type: 'boolean', required: true, section: 'Methods' },
  { id: 'c-blinding-out', label: 'Outcome assessor blinding?', type: 'boolean', required: true, section: 'Methods' },
  { id: 'c-it-analysis', label: 'Intention-to-treat analysis?', type: 'boolean', required: true, section: 'Results' },
  { id: 'c-flow-diagram', label: 'Patient flow diagram provided?', type: 'boolean', required: true, section: 'Results' },
];

const PRISMA_FIELDS: FormField[] = [
  { id: 'p-protocol', label: 'Review protocol registered?', type: 'boolean', required: true, section: 'Identification' },
  { id: 'p-search-strat', label: 'Search strategy described?', type: 'boolean', required: true, section: 'Identification' },
  { id: 'p-duplicates', label: 'Duplicate screening?', type: 'boolean', required: true, section: 'Screening' },
  { id: 'p-exclusion-reasons', label: 'Exclusion reasons reported?', type: 'boolean', required: true, section: 'Screening' },
  { id: 'p-risk-bias', label: 'Risk of bias assessed?', type: 'boolean', required: true, section: 'Assessment' },
  { id: 'p-funding', label: 'Funding sources disclosed?', type: 'boolean', required: true, section: 'Assessment' },
];

const STROBE_FIELDS: FormField[] = [
  { id: 's-design', label: 'Study design specified?', type: 'boolean', required: true, section: 'Introduction' },
  { id: 's-setting', label: 'Setting and participants described?', type: 'boolean', required: true, section: 'Methods' },
  { id: 's-variables', label: 'Variables clearly defined?', type: 'boolean', required: true, section: 'Methods' },
  { id: 's-bias', label: 'Potential biases discussed?', type: 'boolean', required: true, section: 'Discussion' },
  { id: 's-gen', label: 'Generalisability discussed?', type: 'boolean', required: true, section: 'Discussion' },
];

const ROB2_FIELDS: FormField[] = [
  { id: 'r-random', label: 'Randomisation process', type: 'select', options: ['low', 'some-concerns', 'high'], required: true, section: 'Domain 1' },
  { id: 'r-deviations', label: 'Deviations from intended interventions', type: 'select', options: ['low', 'some-concerns', 'high'], required: true, section: 'Domain 2' },
  { id: 'r-missing', label: 'Missing outcome data', type: 'select', options: ['low', 'some-concerns', 'high'], required: true, section: 'Domain 3' },
  { id: 'r-measurement', label: 'Outcome measurement', type: 'select', options: ['low', 'some-concerns', 'high'], required: true, section: 'Domain 4' },
  { id: 'r-reporting', label: 'Selective reporting', type: 'select', options: ['low', 'some-concerns', 'high'], required: true, section: 'Domain 5' },
];

const NEWCASTLE_FIELDS: FormField[] = [
  { id: 'n-representative', label: 'Representative cohort?', type: 'select', options: ['0', '1'], required: true, section: 'Selection' },
  { id: 'n-selection', label: 'Selection of non-exposed cohort?', type: 'select', options: ['0', '1'], required: true, section: 'Selection' },
  { id: 'n-ascertainment', label: 'Exposure ascertainment?', type: 'select', options: ['0', '1'], required: true, section: 'Selection' },
  { id: 'n-outcome', label: 'Outcome of interest present at start?', type: 'select', options: ['0', '1'], required: true, section: 'Selection' },
  { id: 'n-comparability', label: 'Comparability on design/analysis', type: 'select', options: ['0', '1', '2'], required: true, section: 'Comparability' },
  { id: 'n-assessment', label: 'Outcome assessment?', type: 'select', options: ['0', '1'], required: true, section: 'Outcome' },
  { id: 'n-followup', label: 'Adequate follow-up length?', type: 'select', options: ['0', '1'], required: true, section: 'Outcome' },
  { id: 'n-adequacy', label: 'Adequacy of follow-up?', type: 'select', options: ['0', '1'], required: true, section: 'Outcome' },
];

export function getFormFields(design: StudyDesignType): FormField[] {
  switch (design) {
    case 'consort': return CONSORT_FIELDS;
    case 'prisma': return PRISMA_FIELDS;
    case 'strobe': return STROBE_FIELDS;
    case 'rob2': return ROB2_FIELDS;
    case 'newcastle': return NEWCASTLE_FIELDS;
    default: return [];
  }
}

export function computeNewcastleScore(fields: Record<string, string>): number {
  return Object.values(fields).reduce((sum, v) => sum + (parseInt(v, 10) || 0), 0);
}

export function gradeCertainty(outcome: GradeOutcome): string {
  let downgrades = 0;
  if (outcome.riskOfBias !== 'not-serious') downgrades++;
  if (outcome.inconsistency !== 'not-serious') downgrades++;
  if (outcome.indirectness !== 'not-serious') downgrades++;
  if (outcome.imprecision !== 'not-serious') downgrades++;
  if (outcome.publicationBias !== 'not-serious') downgrades++;

  const levels = ['high', 'moderate', 'low', 'very-low'];
  const idx = Math.min(downgrades, 3);
  return levels[idx]!;
}

export function gradeToLabel(certainty: string): string {
  const map: Record<string, string> = {
    high: 'High — Very confident',
    moderate: 'Moderate — Moderately confident',
    low: 'Low — Limited confidence',
    'very-low': 'Very Low — Very little confidence',
  };
  return map[certainty] ?? certainty;
}
