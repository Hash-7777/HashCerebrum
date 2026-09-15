// The tables a paper carries: characteristics of the cited studies with each
// study's own reported effect estimate, and — for a paper built on an uploaded
// dataset — the dataset summary, baseline characteristics and the inferential
// results of its analysis plan.
//
// Only data tables are published. Every value comes from extraction or from
// computation over the dataset, never from drafted prose, and a value a record
// does not supply is shown as "not reported".

import { buildSoFTableFromPipeline } from './evidenceQuality';
import type {
  AnalysisPlan,
  BaselineCharacteristics,
  CitationMapEntry,
  ClaimLedgerEntry,
  EvidenceExtraction,
  ManuscriptTable,
  UploadedDatasetSummary,
} from './publicationTypes';
import { buildEvidenceMeta } from './metaAnalysis';

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

export function buildTables(
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
