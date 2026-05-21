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
  kind: 'source_yield' | 'prisma_flow' | 'evidence_years' | 'topic_map';
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
  delimiter: ',' | '\t';
  columnSummaries: DatasetColumnSummary[];
  previewRows: Record<string, string>[];
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
