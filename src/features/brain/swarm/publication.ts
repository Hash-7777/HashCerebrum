import type { EvidenceItem } from '@platform/index';
import { buildSoFTableFromPipeline } from './evidenceQuality';
import {
  buildFigures,
  escXml,
  evidenceYears,
  sanitizeSvgForHtml,
  sourceCounts,
} from './publicationFigures';
import { evidenceIdentity, normalizeText, stableHash } from './textNormalize';
import {
  containsPromptLeakage,
  SECTION_PLAN,
  stripPromptLeakage,
  type Manuscript,
  type ManuscriptSection,
} from './manuscript';
import type {
  AnalysisPlan,
  BaselineCharacteristics,
  CanonicalReference,
  CitationMapEntry,
  ComplianceItem,
  CslReference,
  ClaimLedgerEntry,
  EvidenceExtraction,
  EvidenceStrength,
  ManuscriptFigure,
  ManuscriptStandard,
  ManuscriptTable,
  ManuscriptValidation,
  PaperBlueprint,
  PaperPackageQa,
  PublicationArtifact,
  StatisticsPayload,
  UploadedDatasetSummary,
  ValidationIssue,
} from './publicationTypes';
import { expandCitationMarkers } from './citationMarkers';
import { applyHonestyPass } from './honestyGuard';
import { formatReference, referenceUrl, type CitationStyle } from '../export/citationStyles';
import { buildEvidenceMeta } from './metaAnalysis';

// Resolve a reference's display text in the requested style. Vancouver (or no
// style) returns the text baked at build time verbatim — zero regression — and
// other styles are re-rendered from the underlying evidence record on demand.
function referenceText(reference: CanonicalReference, style?: CitationStyle): string {
  if (!style || style === 'vancouver') return reference.text;
  return formatReference(reference.evidence, style);
}

// Escape the two characters that would break a Markdown link label, so a
// reference title containing brackets cannot corrupt the [label](url) wrapper.
function escapeMdLinkLabel(text: string): string {
  return text.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

// A reference-list line as Markdown: the whole line links to the real paper
// (DOI → PubMed → …) when a URL is resolvable, otherwise plain text.
function referenceMarkdownLine(reference: CanonicalReference, style?: CitationStyle): string {
  const text = referenceText(reference, style);
  const url = referenceUrl(reference.evidence);
  const body = url ? `[${escapeMdLinkLabel(text)}](${url})` : text;
  return `${reference.displayMarker} ${body}`;
}


const SECTION_CITATION_EXEMPT = new Set([
  'Declarations',
  'Dataset and Statistical Analysis',
  'Figures, Tables, and Statistical Safeguards',
  // Methods is generated deterministically from the fixed pipeline description
  // (buildMethodsSection) and cites no findings, so it carries no [S#] markers.
  'Methods',
]);

const SOURCE_CITATION_RX = /\[(?:S)?(\d+)\]/g;

function words(value: string): number {
  return value.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length;
}

function sourceMarker(index: number): string {
  return `S${index + 1}`;
}

function textFromManuscript(manuscript: Manuscript): string {
  return [
    manuscript.title,
    manuscript.abstract.background,
    manuscript.abstract.objective,
    manuscript.abstract.methods,
    manuscript.abstract.results,
    manuscript.abstract.conclusions,
    ...manuscript.sections.flatMap((section) => [section.heading, ...section.body]),
  ].join('\n\n');
}

export function citedSourceNumbers(manuscript: Manuscript): number[] {
  const seen = new Set<number>();
  // Expand grouped / ranged markers first so a record cited only inside
  // "[S25, S27]" is still recognised as cited and kept in the reference list.
  const text = expandCitationMarkers(textFromManuscript(manuscript), 200);
  for (const match of text.matchAll(SOURCE_CITATION_RX)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) seen.add(value);
  }
  return [...seen].sort((a, b) => a - b);
}

function cslType(record: EvidenceItem): CslReference['type'] {
  if (record.source === 'ctgov') return 'clinical-trial';
  if (record.source === 'openfda' || record.source === 'rxnorm') return 'report';
  if (record.url && !record.identifiers?.doi && !record.identifiers?.pmid) return 'webpage';
  return 'article-journal';
}

function cslAuthors(authors: string[]): { family: string; given?: string }[] | undefined {
  const parsed = authors
    .map((author) => author.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((author) => {
      const parts = author.split(/\s+/);
      if (parts.length <= 1) return { family: author };
      return { family: parts.at(-1)!, given: parts.slice(0, -1).join(' ') };
    });
  return parsed.length > 0 ? parsed : undefined;
}

function cslReference(record: EvidenceItem, id: string): CslReference {
  const year = typeof record.year === 'number' ? record.year : Number(record.year);
  const authors = cslAuthors(record.authors);
  return {
    id,
    type: cslType(record),
    title: record.title,
    ...(authors ? { author: authors } : {}),
    ...(Number.isFinite(year) ? { issued: { 'date-parts': [[year]] } } : {}),
    ...(record.identifiers?.doi ? { DOI: record.identifiers.doi } : {}),
    ...(record.identifiers?.pmid ? { PMID: record.identifiers.pmid } : {}),
    ...(record.url ? { URL: record.url } : {}),
    source: record.source,
  };
}

function canonicalReferences(manuscript: Manuscript, evidence: EvidenceItem[]) {
  const cited = citedSourceNumbers(manuscript);
  const byIdentity = new Map<string, CanonicalReference>();
  const byTitleYear = new Map<string, CanonicalReference>();
  const references: CanonicalReference[] = [];
  const citationMap: Record<string, CitationMapEntry> = {};

  for (const number of cited) {
    const evidenceIndex = number - 1;
    const record = evidence[evidenceIndex];
    if (!record) continue;
    // An untitled record is not a verifiable citation — it renders as a bare
    // ". pubmed." reference. Skip it so it never enters the reference list; its
    // marker then resolves to nothing and is dropped from the body by
    // replaceCitations, keeping the numbering sequential and honest.
    if (!record.title || !record.title.trim()) continue;

    const identity = evidenceIdentity(record);
    let reference = byIdentity.get(identity);

    // I5: cross-source fuzzy dedup — if primary identifiers differ but
    // normalized title+year match, merge into the same reference.
    if (!reference) {
      const titleYearKey = `title:${normalizeText(record.title).toLowerCase()}-${record.year ?? ''}`;
      reference = byTitleYear.get(titleYearKey);
      if (reference) {
        byIdentity.set(identity, reference);
      }
    }

    if (!reference) {
      const vancouverNumber = references.length + 1;
      const id = `ref-${stableHash(identity)}`;
      reference = {
        id,
        sourceMarker: `[S${number}]`,
        displayMarker: `[${vancouverNumber}]`,
        vancouverNumber,
        evidenceIndex,
        evidence: record,
        csl: cslReference(record, id),
        text: formatReference(record, 'vancouver'),
      };
      byIdentity.set(identity, reference);
      const titleYearKey = `title:${normalizeText(record.title).toLowerCase()}-${record.year ?? ''}`;
      byTitleYear.set(titleYearKey, reference);
      references.push(reference);
    }

    const marker = sourceMarker(evidenceIndex);
    citationMap[marker] = {
      sourceMarker: `[${marker}]`,
      displayMarker: reference.displayMarker,
      referenceId: reference.id,
      evidenceIndex,
    };
  }

  return { references, citationMap };
}


// A PRISMA 2020-style study-selection flow built from the counts the pipeline
// already knows: records identified (per source), duplicates removed, records
// screened, and records included/cited — with exclusion side-boxes. Honestly
// labelled as an automated screen (no dual independent reviewers), so it reads as
// a real selection diagram rather than a decorative flow.
function baselineCharacteristicsTable(baseline: BaselineCharacteristics): ManuscriptTable {
  return {
    id: 'table-baseline-characteristics',
    title: `Baseline characteristics by ${baseline.groupColumn}`,
    caption:
      `Participant characteristics compared between ${baseline.groupColumn} = ${baseline.groupALabel} (n=${baseline.nA}) and ${baseline.groupBLabel} (n=${baseline.nB}). ` +
      "Numeric variables are mean ± SD compared with Welch's t-test; categorical variables are n (%) compared with the chi-square or Fisher exact test. All values are computed in-app from the uploaded dataset. Abbreviations: SD, standard deviation; n, count; %, percentage of the group.",
    columns: [
      'Characteristic',
      `${baseline.groupALabel} (n=${baseline.nA})`,
      `${baseline.groupBLabel} (n=${baseline.nB})`,
      'p-value',
    ],
    rows: baseline.rows.map((row) => [
      row.variable,
      row.groupA,
      row.groupB,
      row.pValue === null ? '—' : fmtPValue(row.pValue),
    ]),
  };
}

// A journal-style summary cell: numeric variables as mean ± SD (median; range),
// categorical variables as level counts and percentages — rather than a raw
// "n=…, missing=…, mean=…" worksheet string.
function describeColumn(column: UploadedDatasetSummary['columnSummaries'][number]): string {
  if (column.type === 'numeric') {
    if (column.mean === undefined || column.sd === undefined) return '—';
    const centre = `${fmtStat(column.mean)} ± ${fmtStat(column.sd)}`;
    const extra = [
      column.median !== undefined ? `median ${fmtStat(column.median)}` : '',
      column.min !== undefined && column.max !== undefined ? `range ${fmtStat(column.min)}–${fmtStat(column.max)}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    return extra ? `${centre} (${extra})` : centre;
  }
  const total = column.nonMissing || 1;
  return (
    column.levels
      ?.slice(0, 6)
      .map((level) => `${level.value}: ${level.count} (${((level.count / total) * 100).toFixed(1)}%)`)
      .join('; ') ?? '—'
  );
}

function datasetTable(dataset: UploadedDatasetSummary): ManuscriptTable {
  return {
    id: 'table-dataset-descriptives',
    title: 'Cohort characteristics',
    caption:
      'Computed in-app from the uploaded dataset. Numeric variables are summarised as mean ± SD (median; range); categorical variables as counts and percentages of non-missing values. Abbreviations: N, number of non-missing observations; SD, standard deviation.',
    columns: ['Variable', 'N', 'Summary (mean ± SD or n (%))'],
    rows: dataset.columnSummaries.map((column) => [column.name, String(column.nonMissing), describeColumn(column)]),
  };
}

function fmtStat(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(2);
}

function fmtPValue(p: number | undefined): string {
  if (p === undefined || !Number.isFinite(p)) return 'n/a';
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}

/** Table of the inferential analyses computed by the validated engine. */
function inferentialTable(plan: AnalysisPlan): ManuscriptTable {
  const rows: string[][] = [];
  for (const analysis of plan.analyses) {
    const estimate = analysis.estimate
      ? `${analysis.estimate.label} ${fmtStat(analysis.estimate.point)} (95% CI ${fmtStat(analysis.estimate.ciLow)} to ${fmtStat(analysis.estimate.ciHigh)})`
      : analysis.statistic
        ? `${analysis.statistic.name} = ${fmtStat(analysis.statistic.value)}`
        : '—';
    rows.push([analysis.title, estimate, fmtPValue(analysis.pValue)]);
  }
  if (plan.subgroups) {
    rows.push([
      `Mantel–Haenszel subgroup analysis by ${plan.subgroups.stratifier}`,
      `Pooled odds ratio ${fmtStat(plan.subgroups.pooledOddsRatio)} (95% CI ${fmtStat(plan.subgroups.pooledCiLow)} to ${fmtStat(plan.subgroups.pooledCiHigh)})`,
      `${fmtPValue(plan.subgroups.homogeneityP)} (Breslow–Day homogeneity)`,
    ]);
  }
  if (plan.survival?.logRank) {
    rows.push([
      'Log-rank test',
      `Hazard ratio ${fmtStat(plan.survival.logRank.hazardRatio)} (95% CI ${fmtStat(plan.survival.logRank.ciLow)} to ${fmtStat(plan.survival.logRank.ciHigh)})`,
      fmtPValue(plan.survival.logRank.pValue),
    ]);
  }
  if (plan.survival?.cox) {
    for (const term of plan.survival.cox.terms) {
      rows.push([
        `Cox regression — ${term.name}`,
        `Hazard ratio ${fmtStat(term.hazardRatio)} (95% CI ${fmtStat(term.ciLow)} to ${fmtStat(term.ciHigh)})`,
        fmtPValue(term.pValue),
      ]);
    }
  }
  return {
    id: 'table-inferential-statistics',
    title: 'Inferential statistics',
    caption:
      'Computed in-app by the validated analysis engine directly from the uploaded dataset. The language model narrates these values but does not generate them. Abbreviations: CI, confidence interval; OR, odds ratio; RR, risk ratio; HR, hazard ratio.',
    columns: ['Analysis', 'Estimate (95% CI)', 'p-value'],
    rows,
  };
}

// The renumbered [n] a source is cited as in the body, so a table cell lines up
// with the references and the prose rather than showing the internal [S#].
function displayMarkerFor(sourceMarker: string, citationMap: Record<string, CitationMapEntry>): string {
  return citationMap[sourceMarker.replace(/[[\]]/g, '')]?.displayMarker ?? sourceMarker;
}

// A source-reported effect estimate for the characteristics table: the first
// bound effect (paired with ITS OWN CI and p-value), else a labelled ratio, else
// an honest "not reported". Never recombines numbers across studies.
function primaryReportedEffect(extraction: EvidenceExtraction): string {
  const bound = extraction.boundEffects?.find((effect) => effect.value);
  if (bound) {
    const ci = bound.ci ? `, 95% CI ${bound.ci}` : '';
    const p = bound.pValue ? `, p=${bound.pValue}` : '';
    return `${bound.measure} ${bound.value}${ci ? ` (${ci.replace(/^, /, '')}${p})` : p ? ` (${p.replace(/^, /, '')})` : ''}`;
  }
  const ratio = extraction.effectValues.find((effect) =>
    ['odds ratio', 'risk ratio', 'hazard ratio'].includes(effect.label),
  );
  if (ratio) return `${ratio.label} ${ratio.value}`;
  return 'not reported';
}

function truncateTitle(title: string, max = 80): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

// Table 1 — Characteristics of included studies. A standard journal table (not an
// internal worksheet): one row per cited study with its design, sample size, and
// primary reported effect estimate. This is the DATA the review is built on,
// shown as a table instead of only narrated in prose.
function studyCharacteristicsTable(
  extractions: EvidenceExtraction[],
  citationMap: Record<string, CitationMapEntry>,
): ManuscriptTable | null {
  const rows = extractions
    .filter((extraction) => citationMap[extraction.sourceMarker.replace(/[[\]]/g, '')])
    .slice(0, 30)
    .map((extraction) => [
      displayMarkerFor(extraction.sourceMarker, citationMap),
      truncateTitle(extraction.title),
      extraction.year ?? 'not reported',
      extraction.studyDesign || 'not reported',
      extraction.sampleSize ?? 'not reported',
      primaryReportedEffect(extraction),
    ]);
  if (rows.length === 0) return null;
  return {
    id: 'table-study-characteristics',
    title: 'Characteristics of included studies',
    caption:
      'Study-level design, sample size, and the primary reported effect estimate extracted from each cited record. Each estimate is paired with the same study’s confidence interval and p-value as reported in the source; “not reported” means the record supplied no such value. Reference numbers match the body and reference list. Abbreviations: OR, odds ratio; RR, risk ratio; HR, hazard ratio; CI, confidence interval.',
    columns: ['Ref', 'Study', 'Year', 'Design', 'Sample size', 'Reported effect estimate'],
    rows,
  };
}

function buildTables(
  citationMap: Record<string, CitationMapEntry>,
  dataset?: UploadedDatasetSummary,
  pipeline?: {
    evidenceExtractions?: EvidenceExtraction[];
    claimLedger?: ClaimLedgerEntry[];
  },
): ManuscriptTable[] {
  // Only DATA tables are published: the search/reference-about source summary and
  // the internal claim-ledger table are intentionally omitted so every table is
  // about the studies and their results, not about the search or the references.
  const tables: ManuscriptTable[] = [];
  if (pipeline?.evidenceExtractions?.length) {
    // Table 1 — characteristics of the cited studies. A standard journal table
    // that surfaces the design, sample size, and reported effect estimate of each
    // study as DATA, rather than leaving those numbers only in prose.
    const characteristics = studyCharacteristicsTable(pipeline.evidenceExtractions, citationMap);
    if (characteristics) tables.push(characteristics);
    // The pooled meta-analysis below is the quantitative-synthesis results table.
    const meta = buildEvidenceMeta(pipeline.evidenceExtractions);
    if (meta && meta.interpretable) {
      tables.push({
        id: 'table-meta-analysis',
        title: 'Pooled quantitative synthesis',
        caption:
          'Inverse-variance random-effects meta-analysis (DerSimonian-Laird) computed in-app from the extracted effect estimates. This is NOT a replacement for a full Cochrane review; it is a rapid quantitative summary when ≥2 studies report comparable continuous outcomes or ratio measures with confidence intervals.',
        columns: ['Parameter', 'Value'],
        rows: [
          ['Studies pooled', String(meta.studies)],
          ['Pooled estimate', `${meta.pooledPoint.toFixed(2)} (95% CI ${meta.ciLow.toFixed(2)} to ${meta.ciHigh.toFixed(2)})`],
          ['p-value', meta.pValue < 0.001 ? '<0.001' : meta.pValue.toFixed(3)],
          ['I² (heterogeneity)', `${Math.round(meta.i2 * 100)}%`],
          ['τ²', meta.tau2.toFixed(3)],
          ['Q statistic', `${meta.qStatistic.toFixed(2)} (df=${meta.qDf}, p=${meta.qPValue < 0.001 ? '<0.001' : meta.qPValue.toFixed(3)})`],
          ['Prediction interval', `${meta.predictionCiLow.toFixed(2)} to ${meta.predictionCiHigh.toFixed(2)}`],
          ['Study effects', meta.studyEffects.map((e) => `${e.sourceMarker}: ${e.point.toFixed(2)} (SE ${e.se.toFixed(2)})`).join('; ')],
        ],
      });
    } else if (pipeline.evidenceExtractions.length >= 2) {
      // Honest insufficient-data path: extractions exist but are not comparable.
      tables.push({
        id: 'table-meta-analysis',
        title: 'Quantitative synthesis',
        caption: 'Too few comparable effect estimates with confidence intervals were available for pooled meta-analysis. The individual study statistics are narrated in the Results section.',
        columns: ['Parameter', 'Value'],
        rows: [['Status', 'Insufficient comparable data for pooling']],
      });
    }
  }
  if (pipeline?.claimLedger?.length && pipeline?.evidenceExtractions?.length) {
    const sof = buildSoFTableFromPipeline(pipeline.claimLedger, pipeline.evidenceExtractions);
    if (sof.outcomes.length > 0) {
      tables.push({
        id: 'table-summary-of-findings',
        title: sof.title,
        caption: 'Summary of findings derived from the automated claim ledger. Study counts and participant totals are extracted directly from the pipeline evidence; certainty reflects the automated strength rating, not a formal GRADE assessment.',
        columns: ['Outcome', 'Studies', 'Participants', 'Certainty'],
        rows: sof.outcomes.map((r) => [
          r.outcome,
          String(r.studies),
          r.participants > 0 ? String(r.participants) : 'not reported',
          r.certainty,
        ]),
      });
    }
  }
  // Baseline characteristics lead the dataset tables — the clinical Table 1 that
  // compares every variable across the two groups before the inferential models.
  if (dataset?.inferential?.baseline) tables.push(baselineCharacteristicsTable(dataset.inferential.baseline));
  if (dataset) tables.push(datasetTable(dataset));
  if (dataset?.inferential?.generated) tables.push(inferentialTable(dataset.inferential));
  return tables;
}

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

function hasReferenceSection(section: ManuscriptSection): boolean {
  return /^(references|bibliography|works cited)$/i.test(section.heading.trim());
}

function evidenceText(
  evidence: EvidenceItem[],
  dataset?: UploadedDatasetSummary,
  extractions?: EvidenceExtraction[],
): string {
  const datasetText = dataset
    ? [
        dataset.filename,
        dataset.sha256,
        dataset.rows,
        ...dataset.columns,
        ...dataset.columnSummaries.flatMap((column) => [
          column.name,
          column.nonMissing,
          column.missing,
          column.mean,
          column.sd,
          column.median,
          column.min,
          column.max,
          ...(column.levels?.flatMap((level) => [level.value, level.count]) ?? []),
        ]),
      ].filter(Boolean).join(' ')
    : '';
  // Every number the validated inferential engine computed is "supported":
  // the report sentences carry the formatted estimates, CIs, and p-values.
  const inferential = dataset?.inferential;
  const inferentialText = inferential
    ? [
        ...inferential.analyses.map((analysis) => analysis.reportText),
        inferential.subgroups?.reportText ?? '',
        ...(inferential.subgroups?.rows.map(
          (row) => `${row.oddsRatio} ${row.ciLow} ${row.ciHigh}`,
        ) ?? []),
        inferential.survival?.reportText ?? '',
      ].join(' ')
    : '';
  const extractionText = extractions
    ? extractions
        .flatMap((item) => [
          item.sampleSize ?? '',
          ...item.effectValues.flatMap((effect) => [effect.value, effect.sourceText]),
          item.keyFinding,
        ])
        .join(' ')
    : '';
  return evidence
    .map((record) => [record.title, record.snippet, record.year, record.identifiers?.doi, record.identifiers?.pmid].filter(Boolean).join(' '))
    .concat([datasetText, inferentialText, extractionText])
    .join(' ')
    .toLowerCase();
}

function unsupportedStatisticIssues(
  manuscript: Manuscript,
  evidence: EvidenceItem[],
  dataset?: UploadedDatasetSummary,
  extractions?: EvidenceExtraction[],
): ValidationIssue[] {
  const supportedText = evidenceText(evidence, dataset, extractions);
  // Also include meta-analysis computed values as supported
  const meta = extractions ? buildEvidenceMeta(extractions) : undefined;
  const metaText = meta?.interpretable
    ? [
        String(meta.pooledPoint),
        String(meta.ciLow),
        String(meta.ciHigh),
        String(meta.i2),
        String(meta.tau2),
        String(meta.qStatistic),
      ].join(' ')
    : '';
  const fullSupported = `${supportedText} ${metaText}`;
  const rx =
    /\b(?:p\s*[<=>]\s*0?\.\d+|(?:hazard ratio|odds ratio|risk ratio|relative risk|hr|or|rr)\s*(?:=|of|:)?\s*\d+(?:\.\d+)?|95%\s*ci\s*[:(]?\s*\d+(?:\.\d+)?\s*(?:-|–|to|,)\s*\d+(?:\.\d+)?)/gi;
  const issues: ValidationIssue[] = [];
  for (const section of manuscript.sections) {
    for (const match of section.body.join(' ').matchAll(rx)) {
      const claim = match[0];
      const numbers = claim.match(/\d+(?:\.\d+)?/g) ?? [];
      const supported = numbers.length > 0 && numbers.every((n) => fullSupported.includes(n.toLowerCase()));
      if (!supported) {
        issues.push({
          severity: 'blocker',
          code: 'unsupported-statistic',
          section: section.heading,
          message: `Statistical claim "${claim}" is not traceable to retrieved evidence or computed statistics.`,
        });
      }
    }
  }
  return issues;
}

function claimConsistencyIssues(manuscript: Manuscript): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scarcityRx = /\b(no|little|limited|insufficient|thin|indirect)\s+(direct\s+)?evidence\b/i;
  const strengthRx = /\b(strong|definitive|conclusive|clear|established|proven)\s+evidence\b/i;
  const safetyRx = /\b(no\s+(meaningful\s+)?risk|safe|safety\s+is\s+established|rules\s+out)\b/i;
  const riskRx = /\b(risk|harm|bleeding|toxicity|adverse|signal|warning)\b/i;

  for (const section of manuscript.sections) {
    const text = section.body.join(' ');
    if (scarcityRx.test(text) && strengthRx.test(text)) {
      issues.push({
        severity: 'warning',
        code: 'claim-consistency-scarcity-strength',
        section: section.heading,
        message: `${section.heading} mixes evidence-scarcity language with strong-evidence language; expert review should confirm the interpretation.`,
      });
    }
    if (safetyRx.test(text) && riskRx.test(text)) {
      issues.push({
        severity: 'warning',
        code: 'claim-consistency-safety-risk',
        section: section.heading,
        message: `${section.heading} contains both safety-assurance and risk-signal wording; the final conclusion may need tighter qualification.`,
      });
    }
  }

  return issues;
}

// Detect the model fabricating an original primary study. This tool only
// reviews retrieved literature, so first-person "we conducted a cohort /
// enrolled patients / used EHR / applied propensity-score matching" language
// is a hallucination that must never reach a reader of a medical document.
function fabricatedPrimaryStudyIssues(manuscript: Manuscript): ValidationIssue[] {
  const fabricationRx =
    /\b(a\s+(retrospective|prospective)\s+cohort\s+study\s+was\s+conducted|we\s+(conducted|enrolled|recruited|anal\w+|performed\s+a\s+(cohort|study))|electronic\s+health\s+records?\s+(were|was)|propensity[-\s]?score\s+match|our\s+(cohort|study\s+population|analysis\s+of\s+patients)|patients\s+were\s+(enrolled|recruited|randomi[sz]ed))\b/i;
  const issues: ValidationIssue[] = [];
  const abstractText = Object.values(manuscript.abstract).filter(Boolean).join(' ');
  if (fabricationRx.test(abstractText)) {
    issues.push({
      severity: 'blocker',
      code: 'fabricated-primary-study',
      section: 'Abstract',
      message:
        'The abstract describes original data collection (a conducted cohort / enrolled patients / EHR / propensity matching). This is an automated literature review — that methodology is fabricated and must be removed.',
    });
  }
  for (const section of manuscript.sections) {
    if (fabricationRx.test(section.body.join(' '))) {
      issues.push({
        severity: 'blocker',
        code: 'fabricated-primary-study',
        section: section.heading,
        message: `${section.heading} claims original data collection (conducted study / enrolled patients / EHR / propensity matching), which is fabricated for an automated literature review and must be rewritten as a description of the retrieved evidence.`,
      });
    }
  }
  return issues;
}

function promptLeakageIssues(manuscript: Manuscript): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (containsPromptLeakage(manuscript.title)) {
    issues.push({
      severity: 'blocker',
      code: 'prompt-leakage',
      message: 'The title contains prompt or instruction text and must be regenerated.',
    });
  }
  // Scan the abstract fields too — they are model-generated and just as prone
  // to leaking system-prompt text as the body sections.
  const abstractText = Object.values(manuscript.abstract).filter(Boolean).join('\n\n');
  if (containsPromptLeakage(abstractText)) {
    issues.push({
      severity: 'blocker',
      code: 'prompt-leakage',
      section: 'Abstract',
      message: 'The abstract contains prompt or instruction text and must be regenerated.',
    });
  }
  for (const section of manuscript.sections) {
    const text = section.body.join('\n\n');
    if (containsPromptLeakage(text)) {
      issues.push({
        severity: 'blocker',
        code: 'prompt-leakage',
        section: section.heading,
        message: `${section.heading} contains prompt or instruction text and must be regenerated.`,
      });
    }
  }
  return issues;
}

function validateManuscript(
  manuscript: Manuscript,
  evidence: EvidenceItem[],
  references: CanonicalReference[],
  dataset?: UploadedDatasetSummary,
  extractions?: EvidenceExtraction[],
): ManuscriptValidation {
  const issues: ValidationIssue[] = [];
  const wordCounts: Record<string, number> = {};
  const cited = citedSourceNumbers(manuscript);
  const citedSet = new Set(cited);
  const sectionPlan = new Map(SECTION_PLAN.map((spec) => [spec.heading, spec]));
  const presentSections = new Set(manuscript.sections.map((section) => section.heading));

  if (!manuscript.title.trim()) {
    issues.push({ severity: 'blocker', code: 'missing-title', message: 'The manuscript has no title.' });
  }

  for (const number of cited) {
    if (!evidence[number - 1]) {
      issues.push({
        severity: 'blocker',
        code: 'unresolved-citation',
        message: `[S${number}] does not resolve to a retrieved evidence record.`,
      });
    }
  }

  if (evidence.length > 0 && cited.length === 0) {
    issues.push({
      severity: 'blocker',
      code: 'no-citations',
      message: 'The manuscript contains retrieved evidence but no inline source citations.',
    });
  }

  for (const spec of SECTION_PLAN) {
    if (!presentSections.has(spec.heading)) {
      issues.push({
        severity: 'blocker',
        code: 'missing-required-section',
        section: spec.heading,
        message: `Required section "${spec.heading}" is missing.`,
      });
    }
  }

  for (const section of manuscript.sections) {
    const count = words(section.body.join(' '));
    wordCounts[section.heading] = count;
    const spec = sectionPlan.get(section.heading);
    if (spec && count < spec.minWords) {
      issues.push({
        severity: 'blocker',
        code: 'section-too-short',
        section: section.heading,
        message: `${section.heading} is ${count} words; required minimum is ${spec.minWords}.`,
      });
    }
    if (!SECTION_CITATION_EXEMPT.has(section.heading) && !/\[(?:S)?\d+\]/.test(section.body.join(' '))) {
      issues.push({
        severity: 'blocker',
        code: 'section-missing-citation',
        section: section.heading,
        message: `${section.heading} has no inline source citation.`,
      });
    }
    if (hasReferenceSection(section)) {
      issues.push({
        severity: 'blocker',
        code: 'model-owned-references',
        section: section.heading,
        message: 'References must be renderer-owned, not model-written body sections.',
      });
    }
  }

  issues.push(...unsupportedStatisticIssues(manuscript, evidence, dataset, extractions));
  issues.push(...claimConsistencyIssues(manuscript));
  issues.push(...fabricatedPrimaryStudyIssues(manuscript));
  issues.push(...promptLeakageIssues(manuscript));

  if (references.length === 0 && citedSet.size > 0) {
    issues.push({
      severity: 'blocker',
      code: 'reference-resolution-empty',
      message: 'Inline citations were found, but no canonical references could be resolved.',
    });
  }

  if (references.length < citedSet.size) {
    issues.push({
      severity: 'warning',
      code: 'deduplicated-references',
      message: `${citedSet.size} inline source markers resolve to ${references.length} deduplicated reference(s).`,
    });
  }

  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  return {
    exportReady: blockers.length === 0,
    blockers,
    warnings: issues.filter((issue) => issue.severity === 'warning'),
    wordCounts,
    citationCount: citedSet.size,
    referenceCount: references.length,
  };
}

function compliance(standard: ManuscriptStandard, validation: ManuscriptValidation, stats: StatisticsPayload): ComplianceItem[] {
  return [
    {
      id: 'citation-resolution',
      label: 'Every inline citation resolves to canonical evidence',
      status: validation.blockers.some((issue) => issue.code === 'unresolved-citation') ? 'blocker' : 'pass',
      detail: `${validation.citationCount} inline citation marker(s), ${validation.referenceCount} canonical reference(s).`,
    },
    {
      id: 'section-depth',
      label: 'Required manuscript sections meet minimum depth',
      status: validation.blockers.some((issue) => issue.code === 'section-too-short') ? 'blocker' : 'pass',
      detail: 'Section word counts are checked before export.',
    },
    {
      id: 'statistics-safety',
      label: 'No model-invented statistical analysis',
      status: validation.blockers.some((issue) => issue.code === 'unsupported-statistic') ? 'blocker' : 'pass',
      detail: stats.safeguards[0] ?? 'Statistics safeguards active.',
    },
    {
      id: 'journal-template',
      label: `${standard.replace(/_/g, ' ').toUpperCase()} export template selected`,
      status: 'pass',
      detail: 'The structured artifact can be rendered through the selected manuscript style.',
    },
  ];
}

function validationWithPaperQa(validation: ManuscriptValidation, paperQa?: PaperPackageQa): ManuscriptValidation {
  if (!paperQa) return validation;
  const blockers = [...validation.blockers, ...paperQa.blockers];
  const warnings = [...validation.warnings, ...paperQa.warnings];
  return {
    ...validation,
    blockers,
    warnings,
    exportReady: blockers.length === 0,
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

export function assertPublicationReady(artifact: PublicationArtifact): void {
  if (artifact.validation.exportReady) return;
  const detail = artifact.validation.blockers.map((issue) => issue.message).join(' ');
  throw new Error(`Manuscript failed publication validation. ${detail}`);
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
