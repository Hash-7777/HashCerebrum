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
  kind: 'source_yield' | 'prisma_flow' | 'evidence_years' | 'topic_map' | 'forest_plot';
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

export interface StatisticsPayload {
  mode: 'evidence_review' | 'original_dataset';
  totalRecords: number;
  uniqueReferences: number;
  sourceCounts: Record<string, number>;
  yearRange: { min: number | null; max: number | null };
  computedAnalyses: string[];
  safeguards: string[];
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
  | 'fisher_exact';

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
export interface AnalysisPlan {
  generated: boolean;
  analyses: AnalysisResult[];
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
