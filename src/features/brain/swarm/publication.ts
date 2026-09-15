import type { EvidenceItem } from '@platform/index';
import {
  buildFigures,
  escXml,
  evidenceYears,
  sanitizeSvgForHtml,
  sourceCounts,
} from './publicationFigures';
import { stripPromptLeakage, type Manuscript } from './manuscript';
import type {
  CanonicalReference,
  CitationMapEntry,
  ClaimLedgerEntry,
  EvidenceExtraction,
  EvidenceStrength,
  ManuscriptFigure,
  ManuscriptStandard,
  ManuscriptTable,
  PaperBlueprint,
  PaperPackageQa,
  PublicationArtifact,
  StatisticsPayload,
  UploadedDatasetSummary,
} from './publicationTypes';
import { expandCitationMarkers } from './citationMarkers';
import { applyHonestyPass } from './honestyGuard';
import { referenceUrl, type CitationStyle } from '../export/citationStyles';
import { buildEvidenceMeta } from './metaAnalysis';
import {
  referenceText,
  referenceMarkdownLine,
  SOURCE_CITATION_RX,
  canonicalReferences,
} from './publicationReferences';
import { buildTables } from './publicationTables';
import {
  hasReferenceSection,
  validateManuscript,
  compliance,
  validationWithPaperQa,
} from './publicationValidation';

function evidenceStrengthCounts(ledger?: ClaimLedgerEntry[]): Record<EvidenceStrength, number> | undefined {
  if (!ledger?.length) return undefined;
  const counts: Record<EvidenceStrength, number> = {
    strong: 0,
    moderate: 0,
    weak: 0,
    context: 0,
  };
  for (const entry of ledger) counts[entry.evidenceStrength] += 1;
  return counts;
}

function extractedNumericStatisticCount(extractions?: EvidenceExtraction[]): number | undefined {
  if (!extractions?.length) return undefined;
  return extractions.reduce((sum, item) => sum + item.effectValues.length + (item.sampleSize ? 1 : 0), 0);
}

function statisticsPayload(
  evidence: EvidenceItem[],
  references: CanonicalReference[],
  dataset?: UploadedDatasetSummary,
  pipeline?: {
    evidenceExtractions?: EvidenceExtraction[];
    claimLedger?: ClaimLedgerEntry[];
  },
): StatisticsPayload {
  const years = evidenceYears(evidence);
  const inferential = dataset?.inferential;
  const strengthCounts = evidenceStrengthCounts(pipeline?.claimLedger);
  const numericCount = extractedNumericStatisticCount(pipeline?.evidenceExtractions);
  const trustedRecordCount = pipeline?.evidenceExtractions?.filter((item) => item.trusted).length;
  const contextRecordCount =
    pipeline?.evidenceExtractions && trustedRecordCount !== undefined
      ? pipeline.evidenceExtractions.length - trustedRecordCount
      : undefined;

  const computedAnalyses = dataset
    ? ['dataset_sha256', 'descriptive_statistics', 'table_one_preview', 'source_counts', 'citation_resolution']
    : ['source_counts', 'unique_record_count', 'citation_resolution', 'year_range'];
  if (pipeline?.evidenceExtractions?.length) computedAnalyses.push('evidence_extraction', 'source_yield');
  if (pipeline?.claimLedger?.length) computedAnalyses.push('claim_ledger', 'evidence_strength_counts');
  if (numericCount && numericCount > 0) computedAnalyses.push('extracted_numeric_statistics');
  // Check if meta-analysis is computable
  if (pipeline?.evidenceExtractions && buildEvidenceMeta(pipeline.evidenceExtractions)?.interpretable) {
    computedAnalyses.push('inverse_variance_meta_analysis');
  }
  if (inferential?.generated) {
    for (const analysis of inferential.analyses) computedAnalyses.push(analysis.kind);
    if (inferential.subgroups) computedAnalyses.push('mantel_haenszel_subgroups');
    if (inferential.survival) {
      computedAnalyses.push('kaplan_meier', 'log_rank');
      if (inferential.survival.cox) computedAnalyses.push('cox_regression');
    }
  }

  const metaResult = pipeline?.evidenceExtractions ? buildEvidenceMeta(pipeline.evidenceExtractions) : undefined;
  const safeguards = inferential?.generated
    ? [
        'Inferential statistics (p-values, confidence intervals, odds and risk ratios, hazard ratios, and survival estimates) were computed in-app by the validated analysis engine directly from the uploaded dataset.',
        'The language model narrates only these computed values and never invents a numerical statistical result.',
      ]
    : metaResult?.interpretable
      ? [
          'Pooled estimates, confidence intervals, and heterogeneity metrics (I², τ², Q) were computed in-app by inverse-variance random-effects meta-analysis from extracted source statistics.',
          'The language model narrates only these computed values and extracted source statistics; it does not invent numerical results.',
        ]
      : [
          'No p-values, confidence intervals, hazard ratios, odds ratios, or survival curves are generated without an uploaded dataset or extracted effect-size table.',
          'The language model may narrate retrieved evidence and extracted source statistics, but may not invent numerical statistical results or pooled estimates.',
        ];

  return {
    mode: dataset ? 'original_dataset' : 'evidence_review',
    totalRecords: evidence.length,
    uniqueReferences: references.length,
    sourceCounts: sourceCounts(evidence),
    yearRange: {
      min: years.length ? Math.min(...years) : null,
      max: years.length ? Math.max(...years) : null,
    },
    computedAnalyses: [...new Set(computedAnalyses)],
    safeguards,
    ...(trustedRecordCount !== undefined ? { trustedRecordCount } : {}),
    ...(contextRecordCount !== undefined ? { contextRecordCount } : {}),
    ...(strengthCounts ? { evidenceStrengthCounts: strengthCounts } : {}),
    ...(numericCount !== undefined ? { extractedNumericStatisticCount: numericCount } : {}),
    ...(dataset ? { dataset } : {}),
  };
}

export function buildPublicationArtifact(
  manuscript: Manuscript,
  evidence: EvidenceItem[],
  options: {
    standard?: ManuscriptStandard;
    manuscriptType?: 'evidence_review' | 'original_research';
    dataset?: UploadedDatasetSummary;
    evidenceExtractions?: EvidenceExtraction[];
    claimLedger?: ClaimLedgerEntry[];
    paperBlueprint?: PaperBlueprint;
    paperQa?: PaperPackageQa;
  } = {},
): PublicationArtifact {
  const { references, citationMap } = canonicalReferences(manuscript, evidence);
  const pipeline: { evidenceExtractions?: EvidenceExtraction[]; claimLedger?: ClaimLedgerEntry[] } = {
    ...(options.evidenceExtractions ? { evidenceExtractions: options.evidenceExtractions } : {}),
    ...(options.claimLedger ? { claimLedger: options.claimLedger } : {}),
  };
  const statistics = statisticsPayload(evidence, references, options.dataset, pipeline);
  const baseValidation = validateManuscript(
    manuscript,
    evidence,
    references,
    options.dataset,
    options.evidenceExtractions,
  );
  const validation = validationWithPaperQa(baseValidation, options.paperQa);
  const standard = options.standard ?? 'icmje_generic';
  return {
    schemaVersion: 'hc.manuscript.v2',
    generatedAt: new Date().toISOString(),
    manuscriptType: options.manuscriptType ?? (options.dataset ? 'original_research' : 'evidence_review'),
    standard,
    references,
    citationMap,
    figures: buildFigures(evidence, references.length, citationMap, options.dataset, pipeline),
    tables: buildTables(citationMap, options.dataset, pipeline),
    statistics,
    ...(options.evidenceExtractions ? { evidenceExtractions: options.evidenceExtractions } : {}),
    ...(options.claimLedger ? { claimLedger: options.claimLedger } : {}),
    ...(options.paperBlueprint ? { paperBlueprint: options.paperBlueprint } : {}),
    ...(options.paperQa ? { paperQa: options.paperQa } : {}),
    validation,
    compliance: compliance(standard, validation, statistics),
    exportPackage: {
      includesPdf: true,
      includesManuscriptJson: true,
      includesStatisticsJson: true,
      includesFiguresSvg: true,
      includesReferencesJson: true,
      includesAuditLog: true,
    },
  };
}

function replaceCitations(value: string, citationMap: Record<string, CitationMapEntry>): string {
  // Any marker that does not resolve to a canonical reference (e.g. the model
  // hallucinated "[S43]" when only 20 records exist) is dropped rather than
  // left raw in the rendered text — a citation a reader cannot follow is worse
  // than none. The validator separately blocks such markers from passing QA.
  // Grouped / ranged / fullwidth markers ([S25, S27], [S1-S4], 【S2】) are first
  // expanded to single [S<n>] markers so none leaks past the single-marker pass.
  return expandCitationMarkers(value, Object.keys(citationMap).length)
    .replace(SOURCE_CITATION_RX, (_full, n: string) => citationMap[`S${n}`]?.displayMarker ?? '')
    // Separate adjacent citation markers ("[1][2]" -> "[1] [2]") for readability.
    .replace(/\](\[)/g, '] $1')
    .replace(/ {2,}/g, ' ')
    .replace(/\s+([.,;:)])/g, '$1')
    .trim();
}

function exportText(value: string): string {
  return stripPromptLeakage(value).replace(/\s+/g, ' ').trim();
}

function figureParagraphs(figures: ManuscriptFigure[]): string[] {
  return figures.map((figure, index) => {
    const data = Object.entries(figure.data)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.length : JSON.stringify(value)}`)
      .join('; ');
    return `Figure ${index + 1}. ${figure.title}. ${figure.caption}${data ? ` Data summary: ${data}.` : ''}`;
  });
}

function tableParagraphs(tables: ManuscriptTable[]): string[] {
  return tables.map((table, index) => {
    const rows = table.rows.map((row) => row.map((cell, i) => `${table.columns[i]}: ${cell}`).join('; ')).join(' ');
    return `Table ${index + 1}. ${table.title}. ${table.caption} ${rows}`;
  });
}

export function normalizeManuscriptForPublication(
  manuscript: Manuscript,
  artifact: PublicationArtifact,
  options: { includeSupplementalSection?: boolean } = {},
): Manuscript {
  const includeSupplementalSection = options.includeSupplementalSection ?? true;
  const sections = manuscript.sections
    .filter((section) => !hasReferenceSection(section))
    .map((section) => ({
      heading: exportText(section.heading),
      body: section.body
        .map((paragraph) => applyHonestyPass(replaceCitations(exportText(paragraph), artifact.citationMap)))
        .filter(Boolean),
    }));

  const supplementalBody = [
    ...figureParagraphs(artifact.figures),
    ...tableParagraphs(artifact.tables),
    `Statistics safeguard. This artifact is an ${artifact.statistics.mode.replace('_', ' ')} manuscript. Computed analyses: ${artifact.statistics.computedAnalyses.join(', ')}. ${artifact.statistics.safeguards.join(' ')}`,
  ];

  return {
    ...manuscript,
    title: exportText(manuscript.title) || 'HashCerebrum Research Manuscript',
    abstract: {
      background: applyHonestyPass(replaceCitations(exportText(manuscript.abstract.background), artifact.citationMap)),
      objective: applyHonestyPass(replaceCitations(exportText(manuscript.abstract.objective), artifact.citationMap)),
      methods: applyHonestyPass(replaceCitations(exportText(manuscript.abstract.methods), artifact.citationMap)),
      results: applyHonestyPass(replaceCitations(exportText(manuscript.abstract.results), artifact.citationMap)),
      conclusions: applyHonestyPass(replaceCitations(exportText(manuscript.abstract.conclusions), artifact.citationMap)),
    },
    sections: includeSupplementalSection
      ? [
          ...sections,
          {
            heading: 'Figures, Tables, and Statistical Safeguards',
            body: supplementalBody,
          },
        ]
      : sections,
    publication: artifact,
  };
}

export function referenceLinesForPublication(
  artifact: PublicationArtifact,
  style?: CitationStyle,
): { marker: string; text: string; url?: string }[] {
  return artifact.references.map((reference) => {
    const url = referenceUrl(reference.evidence);
    return {
      marker: reference.displayMarker,
      text: referenceText(reference, style),
      ...(url ? { url } : {}),
    };
  });
}

export function publicationMarkdown(
  manuscript: Manuscript,
  artifact: PublicationArtifact,
  style?: CitationStyle,
): string {
  const normalized = normalizeManuscriptForPublication(manuscript, artifact);
  const lines: string[] = [`# ${normalized.title}`, '', '## Abstract'];
  const a = normalized.abstract;
  if (a.background) lines.push(`**Background:** ${a.background}`);
  if (a.objective) lines.push(`**Objective:** ${a.objective}`);
  if (a.methods) lines.push(`**Methods:** ${a.methods}`);
  if (a.results) lines.push(`**Results:** ${a.results}`);
  if (a.conclusions) lines.push(`**Conclusions:** ${a.conclusions}`);
  if (normalized.keywords.length > 0) lines.push('', `**Keywords:** ${normalized.keywords.join(', ')}`);
  for (const section of normalized.sections) {
    lines.push('', `## ${section.heading}`, ...section.body.map((paragraph) => `\n${paragraph}`));
  }
  if (artifact.figures.length > 0) {
    lines.push('', '## Figure SVG Assets');
    artifact.figures.forEach((figure, index) => {
      lines.push('', `### Figure ${index + 1}. ${figure.title}`, figure.svg);
    });
  }
  if (artifact.references.length > 0) {
    lines.push('', '## References', ...artifact.references.map((reference) => referenceMarkdownLine(reference, style)));
  }
  return `${lines.join('\n')}\n`;
}

export function publicationHtml(
  _manuscript: Manuscript,
  artifact: PublicationArtifact,
  bodyHtml: string,
  style?: CitationStyle,
): string {
  const figures = artifact.figures
    .map(
      (figure, index) => `<figure>${sanitizeSvgForHtml(figure.svg)}<figcaption>Figure ${index + 1}. ${escXml(figure.title)}. ${escXml(figure.caption)}</figcaption></figure>`,
    )
    .join('\n');
  const references = artifact.references
    .map((reference) => {
      const text = referenceText(reference, style);
      const url = referenceUrl(reference.evidence);
      const body = url
        ? `<a href="${escXml(url)}" target="_blank" rel="noreferrer">${escXml(text)}</a>`
        : escXml(text);
      return `<li>${escXml(reference.displayMarker)} ${body}</li>`;
    })
    .join('\n');
  return `${bodyHtml}
<section class="figures"><h2>Figures</h2>${figures}</section>
<section class="references"><h2>References</h2><ol>${references}</ol></section>`;
}
