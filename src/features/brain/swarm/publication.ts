import DOMPurify from 'dompurify';
import type { EvidenceItem } from '@platform/index';
import {
  containsPromptLeakage,
  SECTION_PLAN,
  stripPromptLeakage,
  type Manuscript,
  type ManuscriptSection,
} from './manuscript';
import type {
  AnalysisPlan,
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
import { forestPlotFigure } from './stats/forestPlot';
import { formatReference, type CitationStyle } from '../export/citationStyles';

// Resolve a reference's display text in the requested style. Vancouver (or no
// style) returns the text baked at build time verbatim — zero regression — and
// other styles are re-rendered from the underlying evidence record on demand.
function referenceText(reference: CanonicalReference, style?: CitationStyle): string {
  if (!style || style === 'vancouver') return reference.text;
  return formatReference(reference.evidence, style);
}

const SOURCE_LABELS: Record<EvidenceItem['source'], string> = {
  pubmed: 'PubMed',
  europepmc: 'Europe PMC',
  openalex: 'OpenAlex',
  ctgov: 'ClinicalTrials.gov',
  openfda: 'OpenFDA',
  rxnorm: 'RxNorm',
  library: 'Imported document',
};

const SECTION_CITATION_EXEMPT = new Set([
  'Declarations',
  'Dataset and Statistical Analysis',
  'Figures, Tables, and Statistical Safeguards',
]);

const SOURCE_CITATION_RX = /\[(?:S)?(\d+)\]/g;

function escXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Strip dangerous tags and attributes from SVG before embedding in HTML.
 *  Uses DOMPurify with FORCE_BODY so the input is always treated as a
 *  fragment; FORBID_TAGS removes script/style, FORBID_ATTR removes all
 *  event handlers and javascript: / data: URIs. The Rust backend runs a
 *  stricter allowlist via safe_svg_bytes() during PDF compilation.
 */
export function sanitizeSvgForHtml(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'style'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  });
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function evidenceIdentity(record: EvidenceItem): string {
  const doi = record.identifiers?.doi?.trim().toLowerCase();
  if (doi) return `doi:${doi}`;
  const pmid = record.identifiers?.pmid?.trim().toLowerCase();
  if (pmid) return `pmid:${pmid}`;
  const url = record.url?.trim().toLowerCase();
  if (url) return `url:${url}`;
  return `title:${normalizeText(record.title).toLowerCase()}-${record.year ?? ''}`;
}

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
  for (const match of textFromManuscript(manuscript).matchAll(SOURCE_CITATION_RX)) {
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

function formatAuthors(record: EvidenceItem): string {
  if (record.authors.length === 0) return SOURCE_LABELS[record.source];
  const authors = record.authors.slice(0, 6).map((author) => author.trim()).filter(Boolean);
  if (authors.length === 0) return SOURCE_LABELS[record.source];
  const suffix = record.authors.length > authors.length ? ' et al.' : '';
  return `${authors.join(', ')}${suffix}`;
}

function vancouverText(record: EvidenceItem): string {
  const year = record.year ? ` ${record.year}.` : '';
  const doi = record.identifiers?.doi ? ` doi:${record.identifiers.doi}.` : '';
  const pmid = record.identifiers?.pmid ? ` PMID:${record.identifiers.pmid}.` : '';
  const url = !doi && !pmid && record.url ? ` Available from: ${record.url}` : '';
  return normalizeText(`${formatAuthors(record)}. ${record.title}.${year} ${SOURCE_LABELS[record.source]}.${doi}${pmid}${url}`);
}

function canonicalReferences(manuscript: Manuscript, evidence: EvidenceItem[]) {
  const cited = citedSourceNumbers(manuscript);
  const byIdentity = new Map<string, CanonicalReference>();
  const references: CanonicalReference[] = [];
  const citationMap: Record<string, CitationMapEntry> = {};

  for (const number of cited) {
    const evidenceIndex = number - 1;
    const record = evidence[evidenceIndex];
    if (!record) continue;

    const identity = evidenceIdentity(record);
    let reference = byIdentity.get(identity);
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
        text: vancouverText(record),
      };
      byIdentity.set(identity, reference);
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

function sourceCounts(evidence: EvidenceItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of evidence) counts[SOURCE_LABELS[record.source]] = (counts[SOURCE_LABELS[record.source]] ?? 0) + 1;
  return counts;
}

function evidenceYears(evidence: EvidenceItem[]): number[] {
  return evidence
    .map((record) => Number(record.year))
    .filter((year) => Number.isFinite(year) && year >= 1800 && year <= 2200);
}

function uniqueEvidenceCount(evidence: EvidenceItem[]): number {
  return new Set(evidence.map(evidenceIdentity)).size;
}

function sourceYieldSvg(counts: Record<string, number>): string {
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, count]) => count));
  const rowH = 26;
  const width = 760;
  const height = Math.max(120, 52 + rows.length * rowH);
  const bars = rows
    .map(([source, count], index) => {
      const y = 42 + index * rowH;
      const barW = Math.round((count / max) * 410);
      return `<text x="28" y="${y + 14}" fill="#dce7f7" font-size="13">${escXml(source)}</text><rect x="190" y="${y}" width="${barW}" height="16" rx="4" fill="#3dd1bf"/><text x="${210 + barW}" y="${y + 13}" fill="#9fb0c7" font-size="12">${count}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" font-family="DejaVu Sans Mono, Libertinus Serif"><rect width="${width}" height="${height}" rx="14" fill="#08111d"/><text x="28" y="26" fill="#f1f6fc" font-size="16" font-weight="700">Evidence source yield</text>${bars}</svg>`;
}

function prismaSvg(total: number, unique: number, cited: number): string {
  const box = (x: number, y: number, label: string, value: string) =>
    `<rect x="${x}" y="${y}" width="250" height="58" rx="10" fill="#111c2b" stroke="#2a3951"/><text x="${x + 125}" y="${y + 24}" text-anchor="middle" fill="#f1f6fc" font-size="13" font-weight="700">${escXml(label)}</text><text x="${x + 125}" y="${y + 44}" text-anchor="middle" fill="#3dd1bf" font-size="14">${escXml(value)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 310" role="img" font-family="DejaVu Sans Mono, Libertinus Serif"><rect width="720" height="310" rx="14" fill="#08111d"/>${box(235, 28, 'Records identified', String(total))}<path d="M360 86 L360 118" stroke="#7f8ea8" stroke-width="2"/>${box(235, 118, 'Unique source records', String(unique))}<path d="M360 176 L360 208" stroke="#7f8ea8" stroke-width="2"/>${box(235, 208, 'Records cited in draft', String(cited))}</svg>`;
}

function yearsSvg(years: number[]): string {
  const counts = new Map<number, number>();
  for (const year of years) counts.set(year, (counts.get(year) ?? 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]).slice(-18);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  const bars = entries
    .map(([year, count], index) => {
      const x = 48 + index * 36;
      const h = Math.max(5, Math.round((count / max) * 120));
      const y = 170 - h;
      return `<rect x="${x}" y="${y}" width="20" height="${h}" rx="4" fill="#8b9eff"/><text x="${x + 10}" y="192" text-anchor="middle" fill="#9fb0c7" font-size="10" transform="rotate(45 ${x + 10} 192)">${year}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 230" role="img" font-family="DejaVu Sans Mono, Libertinus Serif"><rect width="760" height="230" rx="14" fill="#08111d"/><text x="28" y="28" fill="#f1f6fc" font-size="16" font-weight="700">Evidence by publication year</text><line x1="42" y1="174" x2="718" y2="174" stroke="#2a3951"/>${bars}</svg>`;
}

const STRENGTH_STYLE: Array<[EvidenceStrength, string, string]> = [
  ['strong', 'Strong — RCT / review / meta-analysis', '#3dd1bf'],
  ['moderate', 'Moderate — cohort / registry', '#8b9eff'],
  ['weak', 'Weak — cross-sectional / indexed record', '#e3bd63'],
  ['context', 'Context — regulatory / terminology', '#7f8ea8'],
];

function evidenceStrengthSvg(counts: Record<EvidenceStrength, number>): string {
  const rows = STRENGTH_STYLE.filter(([key]) => counts[key] > 0);
  const max = Math.max(1, ...rows.map(([key]) => counts[key]));
  const rowH = 30;
  const width = 760;
  const height = Math.max(120, 56 + rows.length * rowH);
  const bars = rows
    .map(([key, label, color], index) => {
      const y = 48 + index * rowH;
      const barW = Math.round((counts[key] / max) * 330);
      return `<text x="28" y="${y + 14}" fill="#dce7f7" font-size="12">${escXml(label)}</text><rect x="356" y="${y}" width="${barW}" height="18" rx="4" fill="${color}"/><text x="${376 + barW}" y="${y + 14}" fill="#9fb0c7" font-size="12">${counts[key]}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" font-family="DejaVu Sans Mono, Libertinus Serif"><rect width="${width}" height="${height}" rx="14" fill="#08111d"/><text x="28" y="28" fill="#f1f6fc" font-size="16" font-weight="700">Evidence strength distribution</text>${bars}</svg>`;
}

// Count each kind of statistic extracted from source text — so the figure shows
// the actual quantitative yield of the retrieval, not a fabricated estimate.
function numericYieldCounts(extractions: EvidenceExtraction[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  let sampleSizes = 0;
  for (const item of extractions) {
    if (item.sampleSize) sampleSizes += 1;
    for (const effect of item.effectValues) {
      counts.set(effect.label, (counts.get(effect.label) ?? 0) + 1);
    }
  }
  const rows: Array<[string, number]> = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sampleSizes > 0) rows.unshift(['sample size', sampleSizes]);
  return rows;
}

function numericYieldSvg(rows: Array<[string, number]>): string {
  const max = Math.max(1, ...rows.map(([, count]) => count));
  const rowH = 26;
  const width = 760;
  const height = Math.max(120, 52 + rows.length * rowH);
  const bars = rows
    .map(([label, count], index) => {
      const y = 42 + index * rowH;
      const barW = Math.round((count / max) * 380);
      return `<text x="28" y="${y + 14}" fill="#dce7f7" font-size="13">${escXml(label)}</text><rect x="240" y="${y}" width="${barW}" height="16" rx="4" fill="#3dd1bf"/><text x="${260 + barW}" y="${y + 13}" fill="#9fb0c7" font-size="12">${count}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" font-family="DejaVu Sans Mono, Libertinus Serif"><rect width="${width}" height="${height}" rx="14" fill="#08111d"/><text x="28" y="26" fill="#f1f6fc" font-size="16" font-weight="700">Extracted statistics by type</text>${bars}</svg>`;
}

function buildFigures(
  evidence: EvidenceItem[],
  referenceCount: number,
  dataset?: UploadedDatasetSummary,
  pipeline?: {
    evidenceExtractions?: EvidenceExtraction[];
    claimLedger?: ClaimLedgerEntry[];
  },
): ManuscriptFigure[] {
  const counts = sourceCounts(evidence);
  const years = evidenceYears(evidence);
  const total = evidence.length;
  const unique = uniqueEvidenceCount(evidence);
  const figures: ManuscriptFigure[] = [
    {
      id: 'fig-source-yield',
      kind: 'source_yield',
      title: 'Evidence source yield',
      caption: `Records retrieved by guarded biomedical source before final manuscript citation filtering. Total retrieved records: ${total}.`,
      alt: 'Horizontal bar chart showing retrieved record counts by biomedical source.',
      svg: sourceYieldSvg(counts),
      data: { sourceCounts: counts, totalRecords: total },
    },
    {
      id: 'fig-prisma-flow',
      kind: 'prisma_flow',
      title: 'Automated evidence flow',
      caption: `Automated source flow from retrieved records to unique records and cited references. This is not a formal human-screened PRISMA diagram.`,
      alt: 'Three-box flow diagram from identified records to unique records to cited records.',
      svg: prismaSvg(total, unique, referenceCount),
      data: { totalRecords: total, uniqueRecords: unique, citedReferences: referenceCount },
    },
  ];

  if (years.length > 0) {
    figures.push({
      id: 'fig-evidence-years',
      kind: 'evidence_years',
      title: 'Evidence year distribution',
      caption: `Distribution of available publication or registry years in retrieved records. Year metadata was present for ${years.length} record(s).`,
      alt: 'Bar chart showing retrieved evidence by year.',
      svg: yearsSvg(years),
      data: { years },
    });
  }

  // Evidence-strength distribution — a quantitative view of the quality mix the
  // synthesis is built on. Always available once the claim ledger exists.
  const strengthCounts = evidenceStrengthCounts(pipeline?.claimLedger);
  if (strengthCounts && Object.values(strengthCounts).some((count) => count > 0)) {
    figures.push({
      id: 'fig-evidence-strength',
      kind: 'evidence_strength',
      title: 'Evidence strength distribution',
      caption:
        'Claim-level evidence-strength counts derived from study design. Strong = RCT / systematic review / meta-analysis; moderate = cohort / registry; weak = cross-sectional / indexed record; context = regulatory / terminology.',
      alt: 'Bar chart showing the count of claims at each evidence-strength tier.',
      svg: evidenceStrengthSvg(strengthCounts),
      data: { evidenceStrengthCounts: strengthCounts },
    });
  }

  // Extracted-statistics yield — how many quantitative results (sample sizes,
  // effect estimates, CIs, p-values) were copied from source text.
  if (pipeline?.evidenceExtractions?.length) {
    const numericRows = numericYieldCounts(pipeline.evidenceExtractions);
    if (numericRows.length > 0) {
      figures.push({
        id: 'fig-numeric-yield',
        kind: 'numeric_yield',
        title: 'Extracted statistics by type',
        caption:
          'Count of numeric statistics copied verbatim from retrieved source text, by type. No pooled estimates or new statistics are computed in evidence-review mode.',
        alt: 'Bar chart showing the count of extracted statistics by type.',
        svg: numericYieldSvg(numericRows),
        data: { numericYield: Object.fromEntries(numericRows) },
      });
    }
  }

  // Forest plot of the computed Mantel–Haenszel subgroup analysis.
  if (dataset?.inferential?.subgroups) {
    figures.push(forestPlotFigure(dataset.inferential.subgroups));
  }

  return figures;
}

function datasetTable(dataset: UploadedDatasetSummary): ManuscriptTable {
  return {
    id: 'table-dataset-descriptives',
    title: 'Dataset descriptive statistics',
    caption:
      'Computed in-app from the uploaded dataset. Inferential statistics are not reported unless a validated analysis plan computes them.',
    columns: ['Variable', 'Type', 'Summary'],
    rows: dataset.columnSummaries.map((column) => {
      const summary =
        column.type === 'numeric'
          ? `n=${column.nonMissing}, missing=${column.missing}, mean=${column.mean}, SD=${column.sd}, median=${column.median}, range=${column.min}-${column.max}`
          : `n=${column.nonMissing}, missing=${column.missing}, levels=${column.levels?.map((level) => `${level.value} ${level.count}`).join(', ') ?? 'none'}`;
      return [column.name, column.type, summary];
    }),
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
      'Computed in-app by the validated analysis engine directly from the uploaded dataset. The language model narrates these values but does not generate them.',
    columns: ['Analysis', 'Estimate (95% CI)', 'p-value'],
    rows,
  };
}

// A transparent, design-based bias-risk signal. This is a deterministic
// heuristic from study design — NOT a formal Cochrane RoB or GRADE appraisal
// (which needs full text) — and is labelled as such so it informs without
// overclaiming. The Limitations section states the absence of a formal RoB.
function designBiasRisk(studyDesign: string): string {
  const design = studyDesign.toLowerCase();
  if (/meta-analysis|systematic review/.test(design)) return 'lower — synthesis design (inherits source bias)';
  if (/randomi[sz]ed|\brct\b/.test(design)) return 'lower — randomized design';
  if (/\bcohort\b/.test(design)) return 'moderate — confounding, selection';
  if (/case[- ]control/.test(design)) return 'moderate — recall, selection';
  if (/registry/.test(design)) return 'moderate — confounding by indication';
  if (/cross[- ]sectional/.test(design)) return 'higher — no temporality, selection';
  if (/case (report|series)/.test(design)) return 'higher — no comparator';
  if (/narrative review/.test(design)) return 'higher — non-systematic selection';
  return 'unrated — design not classified from retrieved text';
}

function evidenceExtractionTable(extractions: EvidenceExtraction[]): ManuscriptTable {
  return {
    id: 'table-evidence-extraction',
    title: 'Structured evidence extraction',
    caption:
      'Agent pipeline extraction table. Each row is bound to an app-owned source marker and contains only fields traceable to the retrieved record metadata or snippet. The bias-risk column is a design-based heuristic, not a formal Cochrane risk-of-bias or GRADE appraisal.',
    columns: ['Source', 'Design', 'Bias-risk (design-based)', 'Population', 'Exposure/intervention', 'Outcomes', 'Numeric support', 'Key finding'],
    rows: extractions.map((item) => [
      `${item.sourceMarker} ${SOURCE_LABELS[item.source]}`,
      item.studyDesign,
      designBiasRisk(item.studyDesign),
      item.population,
      item.exposureOrIntervention,
      item.outcomes.join('; ') || 'not reported in retrieved record',
      [
        item.sampleSize ? `sample ${item.sampleSize}` : '',
        ...item.effectValues.map((effect) => `${effect.label} ${effect.value}`),
      ].filter(Boolean).join('; ') || 'none extracted',
      item.keyFinding,
    ]),
  };
}

function claimLedgerTable(ledger: ClaimLedgerEntry[]): ManuscriptTable {
  return {
    id: 'table-claim-ledger',
    title: 'Claim ledger',
    caption:
      'Section-level claim ledger used to compile the manuscript. The drafting model may use only these source-backed claims and source markers.',
    columns: ['Claim', 'Section', 'Evidence strength', 'Sources', 'Numeric support', 'Contradictions or limits'],
    rows: ledger.map((entry) => [
      entry.claim,
      entry.sectionTarget,
      entry.evidenceStrength,
      entry.supportingSources.join(', '),
      entry.numericSupport.join('; ') || 'none extracted',
      entry.contradictionNotes.join('; ') || 'none recorded',
    ]),
  };
}

function extractedNumericStatisticsTable(extractions: EvidenceExtraction[]): ManuscriptTable | null {
  const rows = extractions.flatMap((item) =>
    item.effectValues.map((effect) => [
      item.sourceMarker,
      effect.label,
      effect.value,
      item.sampleSize ?? 'not reported',
      effect.sourceText,
    ]),
  );
  if (rows.length === 0) return null;
  return {
    id: 'table-extracted-numeric-statistics',
    title: 'Extracted numeric statistics',
    caption:
      'Numeric statistics copied from retrieved source text by the extraction layer. No pooled estimates or new p-values are generated in evidence-review mode.',
    columns: ['Source', 'Statistic', 'Value', 'Sample size', 'Trace text'],
    rows,
  };
}

function buildTables(
  evidence: EvidenceItem[],
  dataset?: UploadedDatasetSummary,
  pipeline?: {
    evidenceExtractions?: EvidenceExtraction[];
    claimLedger?: ClaimLedgerEntry[];
  },
): ManuscriptTable[] {
  const counts = sourceCounts(evidence);
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => {
      const sourceRecords = evidence.filter((record) => SOURCE_LABELS[record.source] === source);
      const years = evidenceYears(sourceRecords);
      const range = years.length ? `${Math.min(...years)}-${Math.max(...years)}` : 'not available';
      return [source, String(count), range];
    });
  const tables: ManuscriptTable[] = [
    {
      id: 'table-source-yield',
      title: 'Evidence source summary',
      caption: 'Retrieved source counts used by the agentic evidence-review pipeline before final citation filtering.',
      columns: ['Source', 'Retrieved records', 'Year range'],
      rows,
    },
  ];
  if (pipeline?.evidenceExtractions?.length) {
    tables.push(evidenceExtractionTable(pipeline.evidenceExtractions));
    const numericTable = extractedNumericStatisticsTable(pipeline.evidenceExtractions);
    if (numericTable) tables.push(numericTable);
  }
  if (pipeline?.claimLedger?.length) tables.push(claimLedgerTable(pipeline.claimLedger));
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
  if (inferential?.generated) {
    for (const analysis of inferential.analyses) computedAnalyses.push(analysis.kind);
    if (inferential.subgroups) computedAnalyses.push('mantel_haenszel_subgroups');
    if (inferential.survival) {
      computedAnalyses.push('kaplan_meier', 'log_rank');
      if (inferential.survival.cox) computedAnalyses.push('cox_regression');
    }
  }

  const safeguards = inferential?.generated
    ? [
        'Inferential statistics (p-values, confidence intervals, odds and risk ratios, hazard ratios, and survival estimates) were computed in-app by the validated analysis engine directly from the uploaded dataset.',
        'The language model narrates only these computed values and never invents a numerical statistical result.',
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
  const rx =
    /\b(?:p\s*[<=>]\s*0?\.\d+|(?:hazard ratio|odds ratio|risk ratio|relative risk|hr|or|rr)\s*(?:=|of|:)?\s*\d+(?:\.\d+)?|95%\s*ci\s*[:(]?\s*\d+(?:\.\d+)?\s*(?:-|–|to|,)\s*\d+(?:\.\d+)?)/gi;
  const issues: ValidationIssue[] = [];
  for (const section of manuscript.sections) {
    for (const match of section.body.join(' ').matchAll(rx)) {
      const claim = match[0];
      const numbers = claim.match(/\d+(?:\.\d+)?/g) ?? [];
      const supported = numbers.length > 0 && numbers.every((n) => supportedText.includes(n.toLowerCase()));
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
    figures: buildFigures(evidence, references.length, options.dataset, pipeline),
    tables: buildTables(evidence, options.dataset, pipeline),
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
  return value
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
        .map((paragraph) => replaceCitations(exportText(paragraph), artifact.citationMap))
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
      background: replaceCitations(exportText(manuscript.abstract.background), artifact.citationMap),
      objective: replaceCitations(exportText(manuscript.abstract.objective), artifact.citationMap),
      methods: replaceCitations(exportText(manuscript.abstract.methods), artifact.citationMap),
      results: replaceCitations(exportText(manuscript.abstract.results), artifact.citationMap),
      conclusions: replaceCitations(exportText(manuscript.abstract.conclusions), artifact.citationMap),
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
): { marker: string; text: string }[] {
  return artifact.references.map((reference) => ({
    marker: reference.displayMarker,
    text: referenceText(reference, style),
  }));
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
    lines.push('', '## References', ...artifact.references.map((reference) => `${reference.displayMarker} ${referenceText(reference, style)}`));
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
    .map((reference) => `<li>${escXml(reference.displayMarker)} ${escXml(referenceText(reference, style))}</li>`)
    .join('\n');
  return `${bodyHtml}
<section class="figures"><h2>Figures</h2>${figures}</section>
<section class="references"><h2>References</h2><ol>${references}</ol></section>`;
}
