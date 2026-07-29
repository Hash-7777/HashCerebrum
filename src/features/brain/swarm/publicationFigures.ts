// Every figure a manuscript carries, drawn as SVG in code.
//
// Nothing here asks a model for anything: a PRISMA flow, a meta-analysis forest
// and a descriptive forest of the individually reported estimates are all
// generated from the evidence the run actually retrieved. That is the point —
// a figure is a claim about the data, and one a model drew would be a claim
// nobody checked.
//
// Two constraints shape the SVG itself. It is inlined into exported HTML, so
// every value is escaped on the way in. And it is re-rendered by Typst for the
// PDF, which supports a narrow subset of SVG, so these builders stay to plain
// shapes and text — no filters, no foreignObject, no external references.
//
// The descriptive forest exists because the meta-analysis one cannot always be
// drawn: pooling requires comparable primary estimates, and on a sparse or
// review-heavy run there are none. Rather than show nothing, the descriptive
// plot lays out each reported ratio with its own interval on a log scale, with
// no pooled diamond — a picture of what was found, not a claim about the whole.

import DOMPurify from 'dompurify';
import type { EvidenceItem } from '@platform/index';
import { buildEvidenceMeta, formatMetaResult, type MetaAnalysisResult } from './metaAnalysis';
import { forestPlotFigure } from './stats/forestPlot';
import { evidenceIdentity } from './textNormalize';
import type {
  CitationMapEntry,
  ClaimLedgerEntry,
  EvidenceExtraction,
  ManuscriptFigure,
  UploadedDatasetSummary,
} from './publicationTypes';

const SOURCE_LABELS: Record<EvidenceItem['source'], string> = {
  pubmed: 'PubMed',
  europepmc: 'Europe PMC',
  openalex: 'OpenAlex',
  ctgov: 'ClinicalTrials.gov',
  openfda: 'OpenFDA',
  rxnorm: 'RxNorm',
  semantic_scholar: 'Semantic Scholar',
  gwas_catalog: 'GWAS Catalog',
  clinvar: 'ClinVar',
  library: 'Imported document',
};

export function sourceCounts(evidence: EvidenceItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of evidence) counts[SOURCE_LABELS[record.source]] = (counts[SOURCE_LABELS[record.source]] ?? 0) + 1;
  return counts;
}

export function evidenceYears(evidence: EvidenceItem[]): number[] {
  return evidence
    .map((record) => Number(record.year))
    .filter((year) => Number.isFinite(year) && year >= 1800 && year <= 2200);
}

export function uniqueEvidenceCount(evidence: EvidenceItem[]): number {
  return new Set(evidence.map(evidenceIdentity)).size;
}


export function escXml(value: string): string {
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


export function prismaFlowSvg(
  total: number,
  unique: number,
  cited: number,
  counts: Record<string, number>,
): string {
  const dupRemoved = Math.max(0, total - unique);
  const notCited = Math.max(0, unique - cited);
  const sourcesRaw = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `${source} ${count}`)
    .join(', ');
  const sources = sourcesRaw.length > 68 ? `${sourcesRaw.slice(0, 65)}…` : sourcesRaw;
  const box = (y: number, label: string, sub?: string, accent = false) =>
    `<rect x="150" y="${y}" width="340" height="${sub ? 58 : 46}" rx="10" fill="#111c2b" stroke="${accent ? '#3dd1bf' : '#2a3951'}"/>` +
    `<text x="320" y="${y + (sub ? 22 : 27)}" text-anchor="middle" fill="#f1f6fc" font-size="12.5" font-weight="700">${escXml(label)}</text>` +
    (sub ? `<text x="320" y="${y + 42}" text-anchor="middle" fill="#9fb0c7" font-size="10.5">${escXml(sub)}</text>` : '');
  const side = (y: number, text: string) =>
    `<rect x="516" y="${y}" width="190" height="40" rx="8" fill="#0d1622" stroke="#3a3145" stroke-dasharray="4 3"/><text x="611" y="${y + 24}" text-anchor="middle" fill="#c6a15a" font-size="10.5">${escXml(text)}</text>`;
  // Arrowheads are drawn as static filled triangles rather than an SVG <marker>.
  // The Typst PDF renderer sanitises every figure SVG through a tag allowlist
  // that does NOT include <marker>, so a marker-based arrow made the sanitizer
  // silently drop the ENTIRE PRISMA figure — the diagram never reached the PDF.
  // A <path> triangle uses only allowlisted tags, so the figure now survives.
  const down = (y1: number, y2: number) =>
    `<line x1="320" y1="${y1}" x2="320" y2="${y2}" stroke="#7f8ea8" stroke-width="2"/>` +
    `<path d="M320 ${y2} L315 ${y2 - 7} L325 ${y2 - 7} Z" fill="#7f8ea8"/>`;
  const branch = (y: number) =>
    `<line x1="490" y1="${y}" x2="516" y2="${y}" stroke="#7f8ea8" stroke-width="1.5" stroke-dasharray="4 3"/>` +
    `<path d="M516 ${y} L509 ${y - 5} L509 ${y + 5} Z" fill="#7f8ea8"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 356" role="img" font-family="DejaVu Sans Mono, Libertinus Serif">` +
    `<rect width="720" height="356" rx="14" fill="#08111d"/>` +
    `<text x="16" y="24" fill="#f1f6fc" font-size="15" font-weight="700">Study selection (PRISMA-style automated flow)</text>` +
    box(44, `Records identified from databases (n = ${total})`, sources) +
    down(102, 122) +
    box(122, `Records after duplicates removed (n = ${unique})`) +
    branch(145) +
    side(125, `Duplicate records removed: ${dupRemoved}`) +
    down(168, 188) +
    box(188, `Records screened & relevance-ranked (n = ${unique})`) +
    branch(211) +
    side(191, `Records not cited: ${notCited}`) +
    down(234, 254) +
    box(254, `Records cited in the synthesis (n = ${cited})`, undefined, true) +
    `<text x="16" y="326" fill="#6b7a91" font-size="10">Automated identification, de-duplication, and relevance screening — not a dual-reviewer PRISMA screen.</text>` +
    `</svg>`
  );
}

function metaAnalysisSvg(meta: MetaAnalysisResult): string {
  const width = 760;
  const rowH = 28;
  const headerH = 56;
  const footerH = 40;
  const studyRows = meta.studyEffects;
  const height = headerH + studyRows.length * rowH + footerH + 24;
  const maxW = 420;
  const x0 = 180;
  const range = Math.max(0.001, meta.ciHigh - meta.ciLow);
  const scale = (v: number) => {
    const t = (v - (meta.pooledPoint - range * 1.2)) / (range * 2.4);
    return x0 + Math.max(0, Math.min(maxW, t * maxW));
  };
  const pooledX = scale(meta.pooledPoint);
  const pooledLow = scale(meta.ciLow);
  const pooledHigh = scale(meta.ciHigh);
  const predLow = scale(meta.predictionCiLow);
  const predHigh = scale(meta.predictionCiHigh);

  let rows = '';
  for (let i = 0; i < studyRows.length; i += 1) {
    const y = headerH + i * rowH;
    const e = studyRows[i]!;
    const cx = scale(e.point);
    const low = scale(e.ciLow);
    const high = scale(e.ciHigh);
    rows += `<text x="12" y="${y + 18}" fill="#dce7f7" font-size="11">${escXml(e.sourceMarker)}</text>`;
    rows += `<text x="72" y="${y + 18}" fill="#9fb0c7" font-size="11">${e.point.toFixed(2)}</text>`;
    rows += `<line x1="${low}" y1="${y + 14}" x2="${high}" y2="${y + 14}" stroke="#7f8ea8" stroke-width="1"/>`;
    rows += `<rect x="${cx - 3}" y="${y + 10}" width="6" height="8" rx="2" fill="#3dd1bf"/>`;
  }

  const yPooled = headerH + studyRows.length * rowH + 4;
  const i2Pct = Math.round(meta.i2 * 100);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" font-family="DejaVu Sans Mono, Libertinus Serif">
<rect width="${width}" height="${height}" rx="14" fill="#08111d"/>
<text x="28" y="26" fill="#f1f6fc" font-size="14" font-weight="700">Random-effects meta-analysis (${meta.kind.toUpperCase()})</text>
<text x="28" y="46" fill="#9fb0c7" font-size="11">Pooled ${meta.pooledPoint.toFixed(2)} (95% CI ${meta.ciLow.toFixed(2)}–${meta.ciHigh.toFixed(2)}); I²=${i2Pct}%; τ²=${meta.tau2.toFixed(3)}</text>
<line x1="${x0}" y1="${headerH - 4}" x2="${x0 + maxW}" y2="${headerH - 4}" stroke="#2a3951"/>
${rows}
<line x1="${pooledLow}" y1="${yPooled + 14}" x2="${pooledHigh}" y2="${yPooled + 14}" stroke="#8b9eff" stroke-width="3"/>
<rect x="${pooledX - 4}" y="${yPooled + 10}" width="8" height="8" rx="3" fill="#8b9eff"/>
<line x1="${predLow}" y1="${yPooled + 26}" x2="${predHigh}" y2="${yPooled + 26}" stroke="#7f8ea8" stroke-width="1" stroke-dasharray="4,3"/>
<text x="12" y="${yPooled + 18}" fill="#f1f6fc" font-size="11" font-weight="700">Pooled</text>
<text x="12" y="${yPooled + 36}" fill="#9fb0c7" font-size="10">Prediction interval</text>
</svg>`;
}

// ── Descriptive forest plot of the individual reported estimates ─────────────
// When ≥2 studies report a ratio estimate with a confidence interval but the set
// is not comparable enough to pool (mixed OR/HR/RR, different outcomes), a real
// review still PLOTS the individual estimates so the reader sees the data. Each
// row is one study's reported ratio on a log scale against a no-effect line at 1;
// no pooled diamond is drawn, because nothing was pooled.
interface ForestRow {
  label: string;
  value: number;
  ciLow: number;
  ciHigh: number;
}

function parseCiPair(ci: string | null): [number, number] | null {
  if (!ci) return null;
  const match = ci.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:-|–|—|to|,)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return null;
  const lo = Number(match[1]);
  const hi = Number(match[2]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0 || lo >= hi) return null;
  return [lo, hi];
}

const RATIO_MEASURE_RX = /\b(OR|RR|HR|odds ratio|risk ratio|relative risk|hazard ratio)\b/i;

function reportedEffectForestRows(
  extractions: EvidenceExtraction[],
  citationMap: Record<string, CitationMapEntry>,
): ForestRow[] {
  const rows: ForestRow[] = [];
  for (const extraction of extractions) {
    const entry = citationMap[extraction.sourceMarker.replace(/[[\]]/g, '')];
    if (!entry) continue;
    const bound = (extraction.boundEffects ?? []).find(
      (effect) => RATIO_MEASURE_RX.test(effect.measure) && parseCiPair(effect.ci) !== null,
    );
    if (!bound) continue;
    const ci = parseCiPair(bound.ci)!;
    const value = Number(bound.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    rows.push({ label: `${entry.displayMarker} ${bound.measure}`, value, ciLow: ci[0], ciHigh: ci[1] });
  }
  return rows;
}

function fmtRatio(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
}

function descriptiveForestSvg(rows: ForestRow[]): string {
  const width = 760;
  const rowHeight = 30;
  const plotLeft = 236;
  const plotRight = 560;
  const plotWidth = plotRight - plotLeft;
  const headerY = 64;
  const firstRowY = headerY + 28;
  const height = firstRowY + rows.length * rowHeight + 22;

  const bounds = [1];
  for (const row of rows) bounds.push(row.value, row.ciLow, row.ciHigh);
  const finite = bounds.filter((value) => Number.isFinite(value) && value > 0);
  const lo = Math.max(0.05, Math.min(...finite, 1) * 0.8);
  const hi = Math.min(64, Math.max(...finite, 1) * 1.25);
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  const xFor = (ratio: number): number => {
    const clamped = Math.min(hi, Math.max(lo, ratio));
    return plotLeft + ((Math.log(clamped) - logLo) / (logHi - logLo)) * plotWidth;
  };

  const parts: string[] = [];
  const axisY = height - 22;
  parts.push(`<line x1="${plotLeft}" y1="${axisY}" x2="${plotRight}" y2="${axisY}" stroke="#2a3951"/>`);
  for (const tick of [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32]) {
    if (tick < lo || tick > hi) continue;
    const x = xFor(tick);
    parts.push(
      `<line x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 5}" stroke="#7f8ea8"/>` +
        `<text x="${x}" y="${axisY + 17}" text-anchor="middle" fill="#9fb0c7" font-size="10">${tick}</text>`,
    );
  }
  const refX = xFor(1);
  parts.push(
    `<line x1="${refX}" y1="${headerY + 10}" x2="${refX}" y2="${axisY}" stroke="#7f8ea8" stroke-dasharray="4 3"/>`,
  );
  rows.forEach((row, index) => {
    const y = firstRowY + index * rowHeight;
    const side = 9;
    parts.push(`<text x="24" y="${y + 4}" fill="#d6deea" font-size="12">${escXml(row.label)}</text>`);
    parts.push(
      `<line x1="${xFor(row.ciLow)}" y1="${y}" x2="${xFor(row.ciHigh)}" y2="${y}" stroke="#8b9eff" stroke-width="2"/>` +
        `<rect x="${xFor(row.value) - side / 2}" y="${y - side / 2}" width="${side}" height="${side}" fill="#8b9eff"/>`,
    );
    parts.push(
      `<text x="${plotRight + 16}" y="${y + 4}" fill="#9fb0c7" font-size="11">${fmtRatio(row.value)} (${fmtRatio(row.ciLow)}–${fmtRatio(row.ciHigh)})</text>`,
    );
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" font-family="DejaVu Sans Mono, Libertinus Serif">` +
    `<rect width="${width}" height="${height}" rx="14" fill="#08111d"/>` +
    `<text x="24" y="32" fill="#f1f6fc" font-size="16" font-weight="700">Reported effect estimates by study</text>` +
    `<text x="24" y="50" fill="#9fb0c7" font-size="11">Each study's reported ratio (95% CI) on a log scale; measure shown per row. No pooled estimate.</text>` +
    parts.join('') +
    `</svg>`
  );
}

function reportedEffectsForestFigure(
  extractions: EvidenceExtraction[],
  citationMap: Record<string, CitationMapEntry>,
): ManuscriptFigure | null {
  const rows = reportedEffectForestRows(extractions, citationMap);
  if (rows.length < 2) return null;
  return {
    id: 'fig-reported-effects-forest',
    kind: 'forest_plot',
    title: 'Reported effect estimates by study',
    caption:
      'Individual effect estimates reported by the retrieved studies, each with its 95% confidence interval on a log scale against the no-effect line at 1. Estimates are shown as reported and are NOT pooled: the measure (OR, RR, HR) is labelled per row because the studies are not comparable enough for a single pooled estimate.',
    alt: 'Forest plot of individual study effect ratios with confidence intervals on a log scale, not pooled.',
    svg: descriptiveForestSvg(rows),
    data: { rows },
  };
}

export function buildFigures(
  evidence: EvidenceItem[],
  referenceCount: number,
  citationMap: Record<string, CitationMapEntry>,
  dataset?: UploadedDatasetSummary,
  pipeline?: {
    evidenceExtractions?: EvidenceExtraction[];
    claimLedger?: ClaimLedgerEntry[];
  },
): ManuscriptFigure[] {
  const counts = sourceCounts(evidence);
  const total = evidence.length;
  const unique = uniqueEvidenceCount(evidence);
  // The PRISMA-style study-selection flow is the one search-provenance figure a
  // real evidence review keeps. The other search/extraction meta charts (source
  // yield, year distribution, evidence-strength mix, extracted-statistics counts)
  // are intentionally omitted so every remaining figure is about the DATA, not
  // about the search or the reference list.
  const figures: ManuscriptFigure[] = [
    {
      id: 'fig-prisma-flow',
      kind: 'prisma_flow',
      title: 'Study selection (PRISMA-style)',
      caption: `Study-selection flow from records identified across biomedical databases, through automated de-duplication and relevance screening, to the records cited in the synthesis. Identified: ${total}; after de-duplication: ${unique}; cited: ${referenceCount}. This is an automated screen, not a dual independent-reviewer PRISMA process.`,
      alt: 'PRISMA-style flow diagram: records identified, duplicates removed, records screened, and records cited, with exclusion counts.',
      svg: prismaFlowSvg(total, unique, referenceCount, counts),
      data: {
        totalRecords: total,
        uniqueRecords: unique,
        citedReferences: referenceCount,
        duplicatesRemoved: Math.max(0, total - unique),
        notCited: Math.max(0, unique - referenceCount),
      },
    },
  ];

  const evidenceMeta = pipeline?.evidenceExtractions
    ? buildEvidenceMeta(pipeline.evidenceExtractions)
    : undefined;

  // Forest plot of the computed Mantel–Haenszel subgroup analysis.
  if (dataset?.inferential?.subgroups) {
    figures.push(forestPlotFigure(dataset.inferential.subgroups));
  }

  // Meta-analysis forest plot when ≥2 studies report comparable effect estimates
  // (continuous outcomes, or ratio measures with CIs). When they are NOT poolable
  // but ≥2 studies still report a ratio with a CI, plot the individual estimates
  // descriptively so the data appears as a figure instead of only in prose.
  {
    const meta = evidenceMeta;
    if (!meta?.interpretable && pipeline?.evidenceExtractions?.length) {
      const descriptive = reportedEffectsForestFigure(pipeline.evidenceExtractions, citationMap);
      if (descriptive) figures.push(descriptive);
    }
    if (meta?.interpretable) {
      figures.push({
        id: 'fig-meta-analysis',
        kind: 'meta_analysis',
        title: 'Pooled quantitative synthesis',
        caption: formatMetaResult(meta),
        alt: 'Forest plot summary of inverse-variance random-effects meta-analysis.',
        svg: metaAnalysisSvg(meta),
        data: {
          studies: meta.studies,
          pooledPoint: meta.pooledPoint,
          ciLow: meta.ciLow,
          ciHigh: meta.ciHigh,
          pValue: meta.pValue,
          i2: meta.i2,
          tau2: meta.tau2,
          qStatistic: meta.qStatistic,
          qDf: meta.qDf,
          qPValue: meta.qPValue,
          predictionCiLow: meta.predictionCiLow,
          predictionCiHigh: meta.predictionCiHigh,
        },
      });
    }
  }

  return figures;
}

