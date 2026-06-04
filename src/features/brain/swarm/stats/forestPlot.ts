// Forest-plot SVG for the inferential statistics engine. Renders a stratified
// (Mantel–Haenszel) subgroup analysis as a publication-style forest plot:
// per-subgroup odds-ratio squares with confidence-interval whiskers on a log
// scale, a no-effect reference line at OR = 1, and a pooled-estimate diamond.
//
// The SVG matches the dark-theme figure style used elsewhere in publication.ts
// and rides the existing ManuscriptFigure path into the Typst PDF renderer.

import type { ManuscriptFigure, SubgroupAnalysis } from '../publicationTypes';

function escXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
}

/** Build a forest-plot figure from a Mantel–Haenszel subgroup analysis. */
export function forestPlotFigure(subgroup: SubgroupAnalysis): ManuscriptFigure {
  const rows = subgroup.rows;
  const width = 760;
  const rowHeight = 30;
  const plotLeft = 212;
  const plotRight = 560;
  const plotWidth = plotRight - plotLeft;
  const headerY = 64;
  const firstRowY = headerY + 28;
  const pooledY = firstRowY + rows.length * rowHeight + 10;
  const height = pooledY + rowHeight + 20;

  // Log-scale domain spanning every estimate and interval bound.
  const values = [1, subgroup.pooledOddsRatio, subgroup.pooledCiLow, subgroup.pooledCiHigh];
  for (const row of rows) values.push(row.oddsRatio, row.ciLow, row.ciHigh);
  const finite = values.filter((value) => Number.isFinite(value) && value > 0);
  const lo = Math.max(0.05, Math.min(...finite, 1) * 0.8);
  const hi = Math.min(64, Math.max(...finite, 1) * 1.25);
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  const xFor = (or: number): number => {
    const clamped = Math.min(hi, Math.max(lo, or));
    return plotLeft + ((Math.log(clamped) - logLo) / (logHi - logLo)) * plotWidth;
  };

  const maxN = Math.max(1, ...rows.map((row) => row.n));
  const parts: string[] = [];

  // Axis ticks.
  const axisY = height - 26;
  parts.push(
    `<line x1="${plotLeft}" y1="${axisY}" x2="${plotRight}" y2="${axisY}" stroke="#2a3951"/>`,
  );
  for (const tick of [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32]) {
    if (tick < lo || tick > hi) continue;
    const x = xFor(tick);
    parts.push(
      `<line x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 5}" stroke="#7f8ea8"/>` +
        `<text x="${x}" y="${axisY + 17}" text-anchor="middle" fill="#9fb0c7" font-size="10">${tick}</text>`,
    );
  }

  // No-effect reference line at OR = 1.
  const refX = xFor(1);
  parts.push(
    `<line x1="${refX}" y1="${headerY + 10}" x2="${refX}" y2="${axisY}" stroke="#7f8ea8" stroke-dasharray="4 3"/>`,
  );

  // Per-subgroup rows.
  rows.forEach((row, index) => {
    const y = firstRowY + index * rowHeight;
    const side = 6 + 8 * Math.sqrt(row.n / maxN);
    parts.push(
      `<text x="24" y="${y + 4}" fill="#d6deea" font-size="12">${escXml(row.label)}</text>`,
    );
    if (Number.isFinite(row.oddsRatio) && Number.isFinite(row.ciLow) && Number.isFinite(row.ciHigh)) {
      parts.push(
        `<line x1="${xFor(row.ciLow)}" y1="${y}" x2="${xFor(row.ciHigh)}" y2="${y}" stroke="#8b9eff" stroke-width="2"/>` +
          `<rect x="${xFor(row.oddsRatio) - side / 2}" y="${y - side / 2}" width="${side}" height="${side}" fill="#8b9eff"/>`,
      );
    }
    parts.push(
      `<text x="${plotRight + 16}" y="${y + 4}" fill="#9fb0c7" font-size="11">${fmt(row.oddsRatio)} (${fmt(row.ciLow)}–${fmt(row.ciHigh)})</text>`,
    );
  });

  // Pooled estimate diamond.
  const px = xFor(subgroup.pooledOddsRatio);
  const pLow = xFor(subgroup.pooledCiLow);
  const pHigh = xFor(subgroup.pooledCiHigh);
  parts.push(
    `<text x="24" y="${pooledY + 4}" fill="#f1f6fc" font-size="12" font-weight="700">Pooled (Mantel–Haenszel)</text>` +
      `<polygon points="${pLow},${pooledY} ${px},${pooledY - 7} ${pHigh},${pooledY} ${px},${pooledY + 7}" fill="#3dd1bf"/>` +
      `<text x="${plotRight + 16}" y="${pooledY + 4}" fill="#3dd1bf" font-size="11" font-weight="700">${fmt(subgroup.pooledOddsRatio)} (${fmt(subgroup.pooledCiLow)}–${fmt(subgroup.pooledCiHigh)})</text>`,
  );

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" font-family="DejaVu Sans Mono, Libertinus Serif">` +
    `<rect width="${width}" height="${height}" rx="14" fill="#08111d"/>` +
    `<text x="24" y="32" fill="#f1f6fc" font-size="16" font-weight="700">Subgroup odds ratios: ${escXml(subgroup.outcome)} by ${escXml(subgroup.exposure)}</text>` +
    `<text x="24" y="50" fill="#9fb0c7" font-size="11">Stratified by ${escXml(subgroup.stratifier)}. Odds ratio (95% CI), log scale.</text>` +
    parts.join('') +
    `</svg>`;

  return {
    id: 'fig-forest-plot',
    kind: 'forest_plot',
    title: `Subgroup odds ratios for ${subgroup.outcome} by ${subgroup.exposure}`,
    caption: `${subgroup.reportText} Squares are subgroup odds ratios sized by stratum size; the diamond is the Mantel–Haenszel pooled estimate. All values are computed in-app from the uploaded dataset.`,
    alt: `Forest plot of odds ratios for ${subgroup.outcome} by ${subgroup.exposure} across ${subgroup.stratifier} subgroups, with a Mantel–Haenszel pooled estimate.`,
    svg,
    data: {
      outcome: subgroup.outcome,
      exposure: subgroup.exposure,
      stratifier: subgroup.stratifier,
      rows: subgroup.rows,
      pooledOddsRatio: subgroup.pooledOddsRatio,
      pooledCiLow: subgroup.pooledCiLow,
      pooledCiHigh: subgroup.pooledCiHigh,
    },
  };
}
