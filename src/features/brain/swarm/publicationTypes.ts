import type { EvidenceItem } from '@platform/index';

export type ManuscriptStandard =
  | 'icmje_generic'
  | 'ama'
  | 'nejm_style'
  | 'lancet_style'
  | 'nature_medicine_style';

export interface CslName {
  family: string;
  given?: string;
}

export interface CslReference {
  id: string;
  type: 'article-journal' | 'clinical-trial' | 'dataset' | 'webpage' | 'report';
  title: string;
  author?: CslName[];
  issued?: { 'date-parts': (string | number)[][] };
  DOI?: string;
  PMID?: string;
  URL?: string;
  source: EvidenceItem['source'];
}

export interface CanonicalReference {
  id: string;
  sourceMarker: string;
  displayMarker: string;
  vancouverNumber: number;
  evidenceIndex: number;
  evidence: EvidenceItem;
  csl: CslReference;
  text: string;
}

export interface CitationMapEntry {
  sourceMarker: string;
  displayMarker: string;
  referenceId: string;
  evidenceIndex: number;
}

export interface ManuscriptFigure {
  id: string;
  kind:
    | 'source_yield'
    | 'prisma_flow'
    | 'evidence_years'
    | 'evidence_strength'
    | 'numeric_yield'
    | 'topic_map'
    | 'forest_plot'
    | 'meta_analysis';
  title: string;
  caption: string;
  alt: string;
  svg: string;
  data: Record<string, unknown>;
}

export interface ManuscriptTable {
  id: string;
  title: string;
  caption: string;
  columns: string[];
  rows: string[][];
}

export type EvidenceStrength = 'strong' | 'moderate' | 'weak' | 'context';

export interface ExtractedEffectValue {
  label: string;
  value: string;
  sourceText: string;
}

// An effect estimate bound to ITS OWN confidence interval and p-value from the
// same clause of a single record — never recombined across studies. direction is
// inferred deterministically from the point estimate and interval.
export interface BoundEffect {
  measure: string; // 'HR' | 'OR' | 'RR' | 'odds ratio' | …
  value: string; // point estimate, e.g. '0.74'
  ci: string | null; // e.g. '0.65-0.85'
  pValue: string | null; // e.g. '0.0008'
  direction: 'reduction' | 'increase' | 'no effect' | 'unknown';
  sourceText: string; // verbatim bound span
}

export interface EvidenceExtraction {
  id: string;
  sourceMarker: string;
  evidenceIndex: number;
  source: EvidenceItem['source'];
  title: string;
  year: string | null;
  identifiers: Record<string, string>;
  studyDesign: string;
  population: string;
  exposureOrIntervention: string;
  comparator: string;
  outcomes: string[];
  sampleSize: string | null;
  effectValues: ExtractedEffectValue[];
  /** Effect estimates bound to their own CI + p-value (no cross-study mixing). */
  boundEffects?: BoundEffect[];
  limitations: string[];
  keyFinding: string;
  trusted: boolean;
}

export interface ClaimLedgerEntry {
  id: string;
  claim: string;
  supportingSources: string[];
  sectionTarget: string;
  evidenceStrength: EvidenceStrength;
  contradictionNotes: string[];
  numericSupport: string[];
}

export interface PaperBlueprintSection {
  heading: string;
  intent: string;
  requiredClaimIds: string[];
  requiredSourceMarkers: string[];
  targetWords: string;
  minWords: number;
}

export interface PaperBlueprint {
  title: string;
  abstractIntent: string;
  sections: PaperBlueprintSection[];
  requiredTables: string[];
  requiredFigures: string[];
}

export interface StatisticsPayload {
  mode: 'evidence_review' | 'original_dataset';
  totalRecords: number;
  uniqueReferences: number;
  sourceCounts: Record<string, number>;
  yearRange: { min: number | null; max: number | null };
  computedAnalyses: string[];
  safeguards: string[];
  trustedRecordCount?: number;
  contextRecordCount?: number;
  evidenceStrengthCounts?: Record<EvidenceStrength, number>;
  extractedNumericStatisticCount?: number;
  dataset?: UploadedDatasetSummary;
}

export interface DatasetColumnSummary {
  name: string;
  type: 'numeric' | 'categorical';
  nonMissing: number;
  missing: number;
  mean?: number;
  sd?: number;
  median?: number;
  min?: number;
  max?: number;
  levels?: { value: string; count: number }[];
}

export interface UploadedDatasetSummary {
  filename: string;
  sha256: string;
  rows: number;
  columns: string[];
  delimiter: ',' | '\t' | null;
  columnSummaries: DatasetColumnSummary[];
  previewRows: Record<string, string>[];
  // Computed by the inferential statistics engine (Phase 42) at upload time.
  inferential?: AnalysisPlan;
}

// --- Inferential statistics engine (Phase 42) -------------------------------
// A validated, in-app analysis plan: every estimate and p-value here is
// computed deterministically in code from the uploaded dataset. The language
// model may narrate these exact numbers but never invents its own.

/** A point estimate with its 95% confidence interval. */
export interface EffectEstimate {
  label: string; // e.g. 'Odds ratio', 'Mean difference', 'Hazard ratio'
  point: number;
  ciLow: number;
  ciHigh: number;
}

export type AnalysisKind =
  | 'two_by_two'
  | 'welch_t'
  | 'mann_whitney'
  | 'anova'
  | 'pearson'
  | 'chi_square'
  | 'fisher_exact'
  | 'risk_score';

/** One computed inferential analysis. */
export interface AnalysisResult {
  id: string;
  kind: AnalysisKind;
  title: string;
  outcome: string;
  exposure?: string;
  estimate?: EffectEstimate;
  pValue?: number;
  statistic?: { name: string; value: number; df?: number };
  reportText: string; // a plain-language narration of the computed result
  caveats: string[];
}

export interface SubgroupRow {
  label: string;
  oddsRatio: number;
  ciLow: number;
  ciHigh: number;
  n: number;
}

/** Stratified (Mantel–Haenszel) subgroup analysis behind the forest plot. */
export interface SubgroupAnalysis {
  outcome: string;
  exposure: string;
  stratifier: string;
  rows: SubgroupRow[];
  pooledOddsRatio: number;
  pooledCiLow: number;
  pooledCiHigh: number;
  homogeneityP: number;
  reportText: string;
}

export interface CoxTerm {
  name: string;
  hazardRatio: number;
  ciLow: number;
  ciHigh: number;
  pValue: number;
}

/** Time-to-event analysis: Kaplan–Meier, log-rank, and Cox regression. */
export interface SurvivalAnalysis {
  timeColumn: string;
  eventColumn: string;
  groupColumn?: string;
  medianSurvival: { group: string; median: number | null }[];
  logRank?: {
    chiSquare: number;
    pValue: number;
    hazardRatio: number;
    ciLow: number;
    ciHigh: number;
  };
  cox?: { converged: boolean; terms: CoxTerm[] };
  reportText: string;
}

/** The full analysis plan stored on an uploaded dataset summary. */
// One row of the baseline-characteristics table: a variable summarised in each
// group with a between-group significance test. Numeric variables carry mean ±
// SD compared by Welch's t-test; categorical variables carry n (%) compared by
// the chi-square or Fisher exact test.
export interface BaselineRow {
  variable: string;
  groupA: string;
  groupB: string;
  pValue: number | null;
  test: string;
}

// "Table 1 — baseline characteristics by group": every other variable compared
// across the two levels of the grouping column, computed in-app from the raw
// dataset. This is the defining data table of a primary-research clinical paper.
export interface BaselineCharacteristics {
  groupColumn: string;
  groupALabel: string;
  groupBLabel: string;
  nA: number;
  nB: number;
  rows: BaselineRow[];
}

export interface AnalysisPlan {
  generated: boolean;
  analyses: AnalysisResult[];
  baseline?: BaselineCharacteristics;
  subgroups?: SubgroupAnalysis;
  survival?: SurvivalAnalysis;
  notes: string[];
}

export interface ValidationIssue {
  severity: 'blocker' | 'warning';
  code: string;
  message: string;
  section?: string;
}

export interface ManuscriptValidation {
  exportReady: boolean;
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
  wordCounts: Record<string, number>;
  citationCount: number;
  referenceCount: number;
}

export interface ComplianceItem {
  id: string;
  label: string;
  status: 'pass' | 'warning' | 'blocker';
  detail: string;
}

export interface PaperPackageQa {
  stage: 'export_ready' | 'blocked';
  exportReady: boolean;
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
  summary: string[];
}

export interface PublicationArtifact {
  schemaVersion: 'hc.manuscript.v2';
  generatedAt: string;
  manuscriptType: 'evidence_review' | 'original_research';
  standard: ManuscriptStandard;
  references: CanonicalReference[];
  citationMap: Record<string, CitationMapEntry>;
  figures: ManuscriptFigure[];
  tables: ManuscriptTable[];
  statistics: StatisticsPayload;
  evidenceExtractions?: EvidenceExtraction[];
  claimLedger?: ClaimLedgerEntry[];
  paperBlueprint?: PaperBlueprint;
  paperQa?: PaperPackageQa;
  validation: ManuscriptValidation;
  compliance: ComplianceItem[];
  exportPackage: {
    includesPdf: boolean;
    includesManuscriptJson: boolean;
    includesStatisticsJson: boolean;
    includesFiguresSvg: boolean;
    includesReferencesJson: boolean;
    includesAuditLog: boolean;
  };
}
