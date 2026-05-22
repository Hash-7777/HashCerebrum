//! Evidence quality assessment — GRADE, Risk-of-Bias, and diagnostic
//! accuracy appraisals. These structures feed into the manuscript
//! validation pipeline and are narrated (never invented) by the LLM.

// ─── GRADE Certainty of Evidence ────────────────────────────────────────────

export type GradeRating = 'high' | 'moderate' | 'low' | 'very_low';

export interface GradeDomain {
  name: string;
  downgrade: boolean;
  reason?: string;
  seriousness: 'serious' | 'very_serious' | 'none';
}

export interface GradeAssessment {
  outcome: string;
  initialCertainty: GradeRating; // RCTs start High; observational starts Low
  finalCertainty: GradeRating;
  domains: GradeDomain[];
  absoluteEffect?: { intervention: string; control: string; difference: string };
  nnt?: number; // Number Needed to Treat
  nnh?: number; // Number Needed to Harm
  explanation: string;
}

const GRADE_ORDER: GradeRating[] = ['high', 'moderate', 'low', 'very_low'];

export function gradeDowngrade(
  initial: GradeRating,
  domains: GradeDomain[],
): { final: GradeRating; explanation: string } {
  let steps = 0;
  const reasons: string[] = [];
  for (const d of domains) {
    if (!d.downgrade) continue;
    const step = d.seriousness === 'very_serious' ? 2 : 1;
    steps += step;
    reasons.push(`${d.name}: ${d.reason ?? d.seriousness}`);
  }
  const idx = GRADE_ORDER.indexOf(initial);
  const finalIdx = Math.min(idx + steps, GRADE_ORDER.length - 1);
  const final = GRADE_ORDER[finalIdx]!;
  const explanation =
    steps === 0
      ? `No downgrade factors identified; certainty remains ${initial}.`
      : `Downgraded ${steps} level${steps > 1 ? 's' : ''} due to: ${reasons.join('; ')}.`;
  return { final, explanation };
}

// ─── Risk of Bias 2 (RCTs) ──────────────────────────────────────────────────

export type Rob2Judgement = 'low' | 'some_concerns' | 'high';

export interface Rob2Domain {
  domain: string;
  judgement: Rob2Judgement;
  support: string; // quoted evidence from the paper
}

export interface Rob2Assessment {
  studyId: string;
  title: string;
  overall: Rob2Judgement;
  domains: Rob2Domain[];
}

export function rob2Overall(domains: Rob2Domain[]): Rob2Judgement {
  if (domains.some((d) => d.judgement === 'high')) return 'high';
  if (domains.some((d) => d.judgement === 'some_concerns')) return 'some_concerns';
  return 'low';
}

export const ROB2_DOMAINS = [
  'Randomisation process',
  'Deviations from intended interventions',
  'Missing outcome data',
  'Measurement of the outcome',
  'Selection of the reported result',
];

// ─── ROBINS-I (non-randomised studies) ──────────────────────────────────────

export type RobinsIJudgement = 'low' | 'moderate' | 'serious' | 'critical' | 'no_information';

export interface RobinsIDomain {
  domain: string;
  judgement: RobinsIJudgement;
  support: string;
}

export interface RobinsIAssessment {
  studyId: string;
  title: string;
  overall: RobinsIJudgement;
  domains: RobinsIDomain[];
}

export function robinsIOverall(domains: RobinsIDomain[]): RobinsIJudgement {
  if (domains.some((d) => d.judgement === 'critical')) return 'critical';
  if (domains.some((d) => d.judgement === 'serious')) return 'serious';
  if (domains.some((d) => d.judgement === 'moderate')) return 'moderate';
  if (domains.some((d) => d.judgement === 'low')) return 'low';
  return 'no_information';
}

export const ROBINSI_DOMAINS = [
  'Confounding',
  'Selection of participants',
  'Classification of interventions',
  'Deviations from intended interventions',
  'Missing data',
  'Measurement of outcomes',
  'Selection of the reported result',
];

// ─── QUADAS-2 (diagnostic accuracy studies) ─────────────────────────────────

export type Quadas2Judgement = 'low' | 'high' | 'unclear';

export interface Quadas2Domain {
  domain: string;
  judgement: Quadas2Judgement;
  support: string;
}

export interface Quadas2Assessment {
  studyId: string;
  title: string;
  patientSelection: Quadas2Domain;
  indexTest: Quadas2Domain;
  referenceStandard: Quadas2Domain;
  flowTiming: Quadas2Domain;
  overall: Quadas2Judgement;
}

export function quadas2Overall(assessment: Omit<Quadas2Assessment, 'overall'>): Quadas2Judgement {
  const domains = [assessment.patientSelection, assessment.indexTest, assessment.referenceStandard, assessment.flowTiming];
  if (domains.some((d) => d.judgement === 'high')) return 'high';
  if (domains.some((d) => d.judgement === 'unclear')) return 'unclear';
  return 'low';
}

// ─── Summary-of-Findings table builder ──────────────────────────────────────

export interface SoFTable {
  title: string;
  outcomes: SoFRow[];
}

export interface SoFRow {
  outcome: string;
  studies: number;
  participants: number;
  certainty: GradeRating;
  relativeEffect?: string;
  absoluteEffect?: string;
  importance: 'critical' | 'important' | 'not_important';
}

export function buildSoFTable(assessments: GradeAssessment[]): SoFTable {
  return {
    title: 'Summary of Findings',
    outcomes: assessments.map((a) => {
      const row: SoFRow = {
        outcome: a.outcome,
        studies: 0,
        participants: 0,
        certainty: a.finalCertainty,
        importance: 'critical',
      };
      if (a.absoluteEffect) {
        row.absoluteEffect = `${a.absoluteEffect.intervention} vs ${a.absoluteEffect.control} (${a.absoluteEffect.difference})`;
      }
      return row;
    }),
  };
}

// ─── NNT / NNH from risk difference ─────────────────────────────────────────

export function nntFromRiskDifference(rd: number): number | null {
  if (!Number.isFinite(rd) || rd === 0) return null;
  const nnt = 1 / Math.abs(rd);
  return Math.round(nnt * 10) / 10;
}

export function nnhFromRiskDifference(rd: number): number | null {
  if (!Number.isFinite(rd) || rd === 0 || rd < 0) return null;
  const nnh = 1 / rd;
  return Math.round(nnh * 10) / 10;
}
