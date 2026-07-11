// Analysis-plan derivation for the inferential statistics engine. Given a
// parsed dataset, this classifies the columns, picks an outcome and exposure
// from column types and name hints, runs the appropriate hypothesis tests,
// and assembles a structured AnalysisPlan. The app derives and runs the plan
// deterministically — the language model never chooses or computes statistics.

import type {
  AnalysisPlan,
  AnalysisResult,
  BaselineCharacteristics,
  BaselineRow,
  SubgroupAnalysis,
  SubgroupRow,
  SurvivalAnalysis,
} from '../publicationTypes';
import { chiSquareTest, fisherExact2x2, mannWhitneyU, mantelHaenszel, oneWayAnova, pearson, twoByTwoEffects, welchTTest, type MhStratum } from './inference';
import { coxRegression, kaplanMeier, logRankTest, type CoxSubject } from './survival';
import { computeRiskScores, RISK_SCORES } from './riskScores';

// Column-name hints — best-effort role detection, not a hard requirement.
const OUTCOME_HINT = /(outcome|event|death|died|mortality|relapse|remission|response|cured|case|positive|infect|complicat|readmiss|progress)/i;
const EXPOSURE_HINT = /(group|arm|treat|exposure|exposed|interven|drug|cohort|therapy|allocation|randomi|active|placebo|control)/i;
const TIME_HINT = /(time|month|day|week|year|duration|followup|follow.?up|survival|tte|^los$)/i;
const STRAT_HINT = /(sex|gender|age.?group|agegrp|stage|grade|region|site|race|ethnic|severity|subgroup|stratum|strata|category|class|type|ward|cent(er|re))/i;
const ID_HINT = /(^id$|_id$|patient.?id|subject.?id|record.?id|identifier)/i;
const POSITIVE_LEVEL = /^(1|y|yes|true|t|pos|positive|event|dead|died|death|case|diseased|relapse|present|abnormal|active|exposed|treated|treatment|intervention)$/i;

const MAX_COX_COVARIATES = 4;
const MIN_GROUP_N = 2;

type ColumnKind = 'binary' | 'numeric' | 'multi' | 'other';

interface Column {
  name: string;
  cells: string[];
  numeric: (number | null)[];
  kind: ColumnKind;
  levels: string[]; // distinct values for binary/multi, sorted
}

function classifyColumns(headers: string[], rows: Record<string, string>[]): Column[] {
  return headers.map((name) => {
    const cells = rows.map((row) => (row[name] ?? '').trim());
    const numeric = cells.map((cell) => {
      if (!cell) return null;
      const value = Number(cell.replace(/,/g, ''));
      return Number.isFinite(value) ? value : null;
    });
    const nonEmpty = cells.filter(Boolean);
    const distinct = [...new Set(nonEmpty)].sort((a, b) => a.localeCompare(b));
    const coverage = nonEmpty.length > 0 ? numeric.filter((v) => v !== null).length / nonEmpty.length : 0;

    let kind: ColumnKind = 'other';
    if (nonEmpty.length >= 1) {
      if (distinct.length === 2) kind = 'binary';
      else if (coverage >= 0.85 && distinct.length > 2) kind = 'numeric';
      else if (distinct.length >= 3 && distinct.length <= 8) kind = 'multi';
    }
    return { name, cells, numeric, kind, levels: kind === 'binary' || kind === 'multi' ? distinct : [] };
  });
}

/** The level of a binary/categorical column treated as the positive / exposed case. */
function positiveLevel(levels: string[]): string {
  const hit = levels.find((level) => POSITIVE_LEVEL.test(level));
  return hit ?? levels[levels.length - 1]!;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function fmtP(p: number): string {
  if (!Number.isFinite(p)) return 'n/a';
  return p < 0.001 ? '<0.001' : p.toFixed(3);
}

// --- analysis builders ------------------------------------------------------

function buildTwoByTwo(outcome: Column, exposure: Column): AnalysisResult | null {
  const oPos = positiveLevel(outcome.levels);
  const ePos = positiveLevel(exposure.levels);
  const eRef = exposure.levels.find((level) => level !== ePos)!;
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (let i = 0; i < outcome.cells.length; i += 1) {
    const o = outcome.cells[i]!;
    const e = exposure.cells[i]!;
    if (!o || !e) continue;
    const event = o === oPos;
    if (e === ePos) event ? (a += 1) : (b += 1);
    else if (e === eRef) event ? (c += 1) : (d += 1);
  }
  if (a + b < MIN_GROUP_N || c + d < MIN_GROUP_N) return null;

  const effects = twoByTwoEffects(a, b, c, d);
  const chi = chiSquareTest([
    [a, b],
    [c, d],
  ]);
  if ('error' in chi) return null;
  const useFisher = chi.lowExpectedWarning;
  const fisher = useFisher ? fisherExact2x2(a, b, c, d) : null;
  const pValue = fisher ? fisher.pValue : chi.pValue;
  const testName = fisher ? "Fisher's exact test" : 'Pearson chi-square test';
  const caveats: string[] = [];
  if (effects.zeroCellCorrection) {
    caveats.push('A zero cell triggered the Haldane–Anscombe 0.5 continuity correction.');
  }
  if (useFisher) caveats.push('An expected cell count below 5 made Fisher’s exact test the reported p-value.');

  return {
    id: 'analysis-two-by-two',
    kind: 'two_by_two',
    title: `${outcome.name} by ${exposure.name}`,
    outcome: outcome.name,
    exposure: exposure.name,
    estimate: {
      label: 'Odds ratio',
      point: effects.oddsRatio,
      ciLow: effects.orCiLow,
      ciHigh: effects.orCiHigh,
    },
    pValue,
    statistic: { name: 'chi-square', value: chi.chiSquare, df: chi.df },
    reportText: `For ${outcome.name} (${oPos}), the odds ratio comparing ${exposure.name} ${ePos} with ${eRef} was ${fmt(effects.oddsRatio)} (95% CI ${fmt(effects.orCiLow)} to ${fmt(effects.orCiHigh)}); risk ratio ${fmt(effects.riskRatio)}, risk difference ${fmt(effects.riskDifference)}. The ${testName} gave p = ${fmtP(pValue)}.`,
    caveats,
  };
}

function buildGroupComparison(outcome: Column, group: Column): AnalysisResult[] {
  const gPos = positiveLevel(group.levels);
  const gRef = group.levels.find((level) => level !== gPos)!;
  const valuesA: number[] = [];
  const valuesB: number[] = [];
  for (let i = 0; i < group.cells.length; i += 1) {
    const value = outcome.numeric[i] ?? null;
    if (value === null) continue;
    if (group.cells[i] === gPos) valuesA.push(value);
    else if (group.cells[i] === gRef) valuesB.push(value);
  }
  if (valuesA.length < MIN_GROUP_N || valuesB.length < MIN_GROUP_N) return [];

  const t = welchTTest(valuesA, valuesB);
  if ('error' in t) return [];
  const mw = mannWhitneyU(valuesA, valuesB);
  return [
    {
      id: 'analysis-welch-t',
      kind: 'welch_t',
      title: `${outcome.name} by ${group.name}`,
      outcome: outcome.name,
      exposure: group.name,
      estimate: {
        label: 'Mean difference',
        point: t.meanDifference,
        ciLow: t.ciLow,
        ciHigh: t.ciHigh,
      },
      pValue: t.pValue,
      statistic: { name: 't', value: t.t, df: t.df },
      reportText: `Mean ${outcome.name} was ${fmt(t.meanA)} for ${group.name} ${gPos} and ${fmt(t.meanB)} for ${gRef}, a difference of ${fmt(t.meanDifference)} (95% CI ${fmt(t.ciLow)} to ${fmt(t.ciHigh)}). Welch's t-test gave t(${fmt(t.df)}) = ${fmt(t.t)}, p = ${fmtP(t.pValue)}.`,
      caveats: [],
    },
    {
      id: 'analysis-mann-whitney',
      kind: 'mann_whitney',
      title: `${outcome.name} by ${group.name} (rank-based)`,
      outcome: outcome.name,
      exposure: group.name,
      pValue: mw.pValue,
      statistic: { name: 'U', value: mw.u },
      reportText: `The Mann–Whitney U test, a rank-based robustness check on ${outcome.name} across ${group.name}, gave U = ${fmt(mw.u)}, p = ${fmtP(mw.pValue)}.`,
      caveats: [],
    },
  ];
}

function buildAnova(outcome: Column, factor: Column): AnalysisResult | null {
  const groups: number[][] = [];
  for (const level of factor.levels) {
    const values: number[] = [];
    for (let i = 0; i < factor.cells.length; i += 1) {
      if (factor.cells[i] === level && outcome.numeric[i] !== null) values.push(outcome.numeric[i]!);
    }
    if (values.length >= MIN_GROUP_N) groups.push(values);
  }
  if (groups.length < 3) return null;

  const anova = oneWayAnova(groups);
  return {
    id: 'analysis-anova',
    kind: 'anova',
    title: `${outcome.name} across ${factor.name}`,
    outcome: outcome.name,
    exposure: factor.name,
    pValue: anova.pValue,
    statistic: { name: 'F', value: anova.f, df: anova.dfBetween },
    reportText: `One-way ANOVA of ${outcome.name} across ${anova.groupCount} ${factor.name} groups gave F(${anova.dfBetween}, ${anova.dfWithin}) = ${fmt(anova.f)}, p = ${fmtP(anova.pValue)} (eta-squared ${fmt(anova.etaSquared)}).`,
    caveats: [],
  };
}

function buildPearson(x: Column, y: Column): AnalysisResult | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.numeric.length; i += 1) {
    if (x.numeric[i] !== null && y.numeric[i] !== null) {
      xs.push(x.numeric[i]!);
      ys.push(y.numeric[i]!);
    }
  }
  if (xs.length < 4) return null;

  // Guard zero-variance inputs that would crash Pearson correlation.
  const varianceX = xs.reduce((sum, v) => sum + (v - xs.reduce((s, x) => s + x, 0) / xs.length) ** 2, 0);
  const varianceY = ys.reduce((sum, v) => sum + (v - ys.reduce((s, y) => s + y, 0) / ys.length) ** 2, 0);
  if (varianceX === 0 || varianceY === 0) return null;

  const r = pearson(xs, ys);
  if ('error' in r) return null;
  return {
    id: 'analysis-pearson',
    kind: 'pearson',
    title: `Correlation: ${x.name} and ${y.name}`,
    outcome: y.name,
    exposure: x.name,
    estimate: { label: 'Correlation r', point: r.r, ciLow: r.ciLow, ciHigh: r.ciHigh },
    pValue: r.pValue,
    statistic: { name: 't', value: r.t, df: r.df },
    reportText: `${x.name} and ${y.name} were correlated r = ${fmt(r.r)} (95% CI ${fmt(r.ciLow)} to ${fmt(r.ciHigh)}; n = ${r.n}), p = ${fmtP(r.pValue)}.`,
    caveats: [],
  };
}

function buildSubgroups(
  outcome: Column,
  exposure: Column,
  stratifier: Column,
): SubgroupAnalysis | null {
  const oPos = positiveLevel(outcome.levels);
  const ePos = positiveLevel(exposure.levels);
  const eRef = exposure.levels.find((level) => level !== ePos)!;
  const strata: MhStratum[] = [];
  for (const level of stratifier.levels) {
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    for (let i = 0; i < outcome.cells.length; i += 1) {
      if (stratifier.cells[i] !== level) continue;
      const o = outcome.cells[i]!;
      const e = exposure.cells[i]!;
      if (!o || !e) continue;
      const event = o === oPos;
      if (e === ePos) event ? (a += 1) : (b += 1);
      else if (e === eRef) event ? (c += 1) : (d += 1);
    }
    if (a + b + c + d > 0) strata.push({ label: `${stratifier.name}: ${level}`, a, b, c, d });
  }
  if (strata.length < 2) return null;

  const mh = mantelHaenszel(strata);
  const rows: SubgroupRow[] = mh.strata.map((stratum) => ({
    label: stratum.label,
    oddsRatio: stratum.oddsRatio,
    ciLow: stratum.ciLow,
    ciHigh: stratum.ciHigh,
    n: stratum.n,
  }));
  return {
    outcome: outcome.name,
    exposure: exposure.name,
    stratifier: stratifier.name,
    rows,
    pooledOddsRatio: mh.pooledOddsRatio,
    pooledCiLow: mh.ciLow,
    pooledCiHigh: mh.ciHigh,
    homogeneityP: mh.homogeneityP,
    reportText: `The Mantel–Haenszel pooled odds ratio for ${outcome.name} by ${exposure.name}, stratified across ${rows.length} ${stratifier.name} subgroups, was ${fmt(mh.pooledOddsRatio)} (95% CI ${fmt(mh.ciLow)} to ${fmt(mh.ciHigh)}). The Breslow–Day test of odds-ratio homogeneity gave p = ${fmtP(mh.homogeneityP)}.`,
  };
}

function buildSurvival(
  time: Column,
  event: Column,
  group: Column | undefined,
  covariateColumns: Column[],
  notes: string[],
): SurvivalAnalysis {
  const eventPos = positiveLevel(event.levels);
  const eventValue = (i: number): number | null => {
    const cell = event.cells[i]!;
    if (!cell) return null;
    return cell === eventPos ? 1 : 0;
  };

  // Kaplan–Meier per group (or one pooled curve).
  const groups = group ? group.levels : ['All'];
  const medianSurvival: { group: string; median: number | null }[] = [];
  for (const level of groups) {
    const times: number[] = [];
    const events: number[] = [];
    for (let i = 0; i < time.numeric.length; i += 1) {
      const t = time.numeric[i] ?? null;
      const e = eventValue(i);
      if (t === null || e === null) continue;
      if (group && group.cells[i] !== level) continue;
      times.push(t);
      events.push(e);
    }
    if (times.length > 0) {
      medianSurvival.push({ group: level, median: kaplanMeier(level, times, events).medianSurvival });
    }
  }

  let logRank: SurvivalAnalysis['logRank'];
  if (group && group.kind === 'binary') {
    const gPos = positiveLevel(group.levels);
    const tA: number[] = [];
    const eA: number[] = [];
    const tB: number[] = [];
    const eB: number[] = [];
    for (let i = 0; i < time.numeric.length; i += 1) {
      const t = time.numeric[i] ?? null;
      const e = eventValue(i);
      if (t === null || e === null) continue;
      if (group.cells[i] === gPos) {
        tA.push(t);
        eA.push(e);
      } else {
        tB.push(t);
        eB.push(e);
      }
    }
    if (tA.length >= MIN_GROUP_N && tB.length >= MIN_GROUP_N) {
      const lr = logRankTest(tA, eA, tB, eB);
      if (!('error' in lr)) {
        logRank = {
          chiSquare: lr.chiSquare,
          pValue: lr.pValue,
          hazardRatio: lr.hazardRatio,
          ciLow: lr.hrCiLow,
          ciHigh: lr.hrCiHigh,
        };
      }
    }
  }

  // Cox regression: the exposure plus numeric covariates.
  const covariateNames: string[] = [];
  const covariateGetters: ((i: number) => number | null)[] = [];
  if (group && group.kind === 'binary') {
    const gPos = positiveLevel(group.levels);
    covariateNames.push(group.name);
    covariateGetters.push((i) => (group.cells[i] ? (group.cells[i] === gPos ? 1 : 0) : null));
  }
  for (const column of covariateColumns) {
    if (covariateNames.length >= MAX_COX_COVARIATES) break;
    covariateNames.push(column.name);
    covariateGetters.push((i) => column.numeric[i] ?? null);
  }

  let cox: SurvivalAnalysis['cox'];
  if (covariateNames.length > 0) {
    const subjects: CoxSubject[] = [];
    for (let i = 0; i < time.numeric.length; i += 1) {
      const t = time.numeric[i] ?? null;
      const e = eventValue(i);
      if (t === null || e === null) continue;
      const covariates = covariateGetters.map((get) => get(i));
      if (covariates.some((value) => value === null)) continue;
      subjects.push({ time: t, event: e, covariates: covariates as number[] });
    }
    const fit = coxRegression(subjects, covariateNames);
    if (fit.converged) {
      cox = {
        converged: true,
        terms: fit.terms.map((term) => ({
          name: term.name,
          hazardRatio: term.hazardRatio,
          ciLow: term.hrCiLow,
          ciHigh: term.hrCiHigh,
          pValue: term.pValue,
        })),
      };
    } else {
      notes.push('Cox regression did not converge on this dataset; the Kaplan–Meier and log-rank results are reported without an adjusted hazard ratio.');
    }
  }

  const parts: string[] = [
    `Time-to-event analysis used ${time.name} as the time variable and ${event.name} as the event indicator.`,
  ];
  for (const entry of medianSurvival) {
    parts.push(
      `Median survival for ${entry.group} was ${entry.median === null ? 'not reached' : fmt(entry.median)}.`,
    );
  }
  if (logRank) {
    parts.push(
      `The log-rank test gave chi-square = ${fmt(logRank.chiSquare)}, p = ${fmtP(logRank.pValue)}, with an unadjusted hazard ratio of ${fmt(logRank.hazardRatio)} (95% CI ${fmt(logRank.ciLow)} to ${fmt(logRank.ciHigh)}).`,
    );
  }
  if (cox) {
    for (const term of cox.terms) {
      parts.push(
        `The Cox-adjusted hazard ratio for ${term.name} was ${fmt(term.hazardRatio)} (95% CI ${fmt(term.ciLow)} to ${fmt(term.ciHigh)}), p = ${fmtP(term.pValue)}.`,
      );
    }
  }

  return {
    timeColumn: time.name,
    eventColumn: event.name,
    ...(group ? { groupColumn: group.name } : {}),
    medianSurvival,
    ...(logRank ? { logRank } : {}),
    ...(cox ? { cox } : {}),
    reportText: parts.join(' '),
  };
}

/**
 * Derive and run a full inferential analysis plan from a parsed dataset.
 * Deterministic and total — never throws; an unsuitable dataset yields an
 * empty plan whose `notes` explain, in plain language, why.
 */
function buildRiskScoreAnalysis(headers: string[], rows: Record<string, string>[]): AnalysisResult | null {
  // Check if any risk-score column hints are present
  const headerLower = headers.map((h) => h.toLowerCase());
  const hasRiskHints = RISK_SCORES.some((rs) =>
    rs.requiredColumns.some((col) => headerLower.some((h) => h.includes(col.toLowerCase()))),
  );
  if (!hasRiskHints || rows.length === 0) return null;

  // Compute risk scores for every row
  const scored = rows.map((r) => computeRiskScores(r)).filter((arr) => arr.length > 0);
  if (scored.length === 0) return null;

  // Summarize the first applicable score across all rows
  const firstEntry = scored[0]![0]! as unknown as { scoreId?: string; scoreName?: string };
  const firstScoreId = firstEntry.scoreId ?? 'unknown';
  const firstScoreName = firstEntry.scoreName ?? 'Risk Score';
  const distribution = new Map<number, number>();
  let totalScore = 0;
  for (const patientScores of scored) {
    const s = patientScores.find((ps) => (ps as unknown as { scoreId: string }).scoreId === firstScoreId);
    if (s) {
      distribution.set(s.score, (distribution.get(s.score) ?? 0) + 1);
      totalScore += s.score;
    }
  }
  if (distribution.size === 0) return null;

  const mean = totalScore / scored.length;
  const distText = [...distribution.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([score, count]) => `${score}: ${count} (${((count / scored.length) * 100).toFixed(1)}%)`)
    .join(', ');

  return {
    id: `risk-${firstScoreId}`,
    kind: 'risk_score',
    title: firstScoreName,
    outcome: firstScoreName,
    reportText: `${firstScoreName} computed for ${scored.length} patients. Mean score = ${fmt(mean)}. Distribution: ${distText}.`,
    caveats: ['Risk scores are computed deterministically from column values. Verify that column names match the intended clinical variables.'],
  };
}

function meanOf(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sdOf(values: number[], m: number): number {
  if (values.length < 2) return 0;
  const varc = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(varc);
}

function pctStr(count: number, total: number): string {
  return total > 0 ? `${count} (${((count / total) * 100).toFixed(1)}%)` : `${count} (—)`;
}

/**
 * Build the "Table 1 — baseline characteristics by group": each remaining
 * variable summarised in both levels of the grouping column, with a between-
 * group significance test (Welch's t for numeric, chi-square/Fisher for
 * categorical). Deterministic — every number is computed here, never by a model.
 */
function buildBaselineCharacteristics(columns: Column[], group: Column): BaselineCharacteristics | null {
  const posLabel = positiveLevel(group.levels);
  const refLabel = group.levels.find((level) => level !== posLabel);
  if (!posLabel || !refLabel) return null;
  const idxA: number[] = [];
  const idxB: number[] = [];
  group.cells.forEach((cell, i) => {
    if (cell === posLabel) idxA.push(i);
    else if (cell === refLabel) idxB.push(i);
  });
  if (idxA.length < MIN_GROUP_N || idxB.length < MIN_GROUP_N) return null;

  const rows: BaselineRow[] = [];
  for (const col of columns) {
    if (col === group || ID_HINT.test(col.name)) continue;
    if (col.kind === 'numeric') {
      const a = idxA.map((i) => col.numeric[i]).filter((v): v is number => v !== null);
      const b = idxB.map((i) => col.numeric[i]).filter((v): v is number => v !== null);
      if (a.length < MIN_GROUP_N || b.length < MIN_GROUP_N) continue;
      const mA = meanOf(a);
      const mB = meanOf(b);
      const t = welchTTest(a, b);
      rows.push({
        variable: col.name,
        groupA: `${fmt(mA)} ± ${fmt(sdOf(a, mA))}`,
        groupB: `${fmt(mB)} ± ${fmt(sdOf(b, mB))}`,
        pValue: 'error' in t ? null : t.pValue,
        test: "Welch's t-test",
      });
    } else if (col.kind === 'binary' || col.kind === 'multi') {
      const levels = col.levels;
      if (levels.length < 2 || levels.length > 6) continue;
      const countA = levels.map((lv) => idxA.filter((i) => col.cells[i] === lv).length);
      const countB = levels.map((lv) => idxB.filter((i) => col.cells[i] === lv).length);
      let pValue: number | null = null;
      let test = 'Chi-square test';
      if (levels.length === 2) {
        const [a, b] = countA as [number, number];
        const [c, d] = countB as [number, number];
        if ([a, b, c, d].some((n) => n < 5)) {
          pValue = fisherExact2x2(a, b, c, d).pValue;
          test = 'Fisher exact test';
        } else {
          const cs = chiSquareTest([countA, countB]);
          pValue = 'error' in cs ? null : cs.pValue;
        }
      } else {
        const cs = chiSquareTest([countA, countB]);
        pValue = 'error' in cs ? null : cs.pValue;
      }
      if (col.kind === 'binary') {
        const pos = positiveLevel(levels);
        const li = levels.indexOf(pos);
        rows.push({
          variable: `${col.name} (${pos})`,
          groupA: pctStr(countA[li]!, idxA.length),
          groupB: pctStr(countB[li]!, idxB.length),
          pValue,
          test,
        });
      } else {
        levels.forEach((lv, li) => {
          rows.push({
            variable: `${col.name} = ${lv}`,
            groupA: pctStr(countA[li]!, idxA.length),
            groupB: pctStr(countB[li]!, idxB.length),
            pValue: li === 0 ? pValue : null, // the overall test p-value once per variable
            test,
          });
        });
      }
    }
  }
  if (rows.length === 0) return null;
  return {
    groupColumn: group.name,
    groupALabel: posLabel,
    groupBLabel: refLabel,
    nA: idxA.length,
    nB: idxB.length,
    rows,
  };
}

export function deriveAnalysisPlan(
  headers: string[],
  rows: Record<string, string>[],
): AnalysisPlan {
  const notes: string[] = [];
  const analyses: AnalysisResult[] = [];
  let baseline: BaselineCharacteristics | undefined;
  let subgroups: SubgroupAnalysis | undefined;
  let survival: SurvivalAnalysis | undefined;

  try {
    if (rows.length < 4) {
      return { generated: false, analyses, notes: ['The dataset has too few rows for inferential analysis.'] };
    }
    const columns = classifyColumns(headers, rows);
    const binary = columns.filter((c) => c.kind === 'binary');
    const numeric = columns.filter((c) => c.kind === 'numeric' && !ID_HINT.test(c.name));
    const multi = columns.filter((c) => c.kind === 'multi');

    // --- Survival (detected first so its event column is not double-used) ---
    const timeColumn = numeric.find((c) => TIME_HINT.test(c.name));
    const eventColumn =
      binary.find((c) => OUTCOME_HINT.test(c.name)) ?? (timeColumn ? binary[0] : undefined);
    const survivalGroup = binary.find((c) => EXPOSURE_HINT.test(c.name) && c !== eventColumn);
    if (timeColumn && eventColumn) {
      const coxCovariates = numeric.filter((c) => c !== timeColumn);
      survival = buildSurvival(timeColumn, eventColumn, survivalGroup, coxCovariates, notes);
    } else if (timeColumn && !eventColumn) {
      notes.push('A time variable was found but no binary event indicator, so survival analysis was skipped.');
    }

    // --- Primary comparison ------------------------------------------------
    const survivalEvent = survival?.eventColumn;
    const outcomeBinary =
      binary.find((c) => OUTCOME_HINT.test(c.name) && c.name !== survivalEvent) ??
      binary.find((c) => c.name !== survivalEvent);
    const exposureBinary =
      binary.find((c) => EXPOSURE_HINT.test(c.name) && c !== outcomeBinary) ??
      binary.find((c) => c !== outcomeBinary);

    if (outcomeBinary && exposureBinary) {
      const twoByTwo = buildTwoByTwo(outcomeBinary, exposureBinary);
      if (twoByTwo) {
        analyses.push(twoByTwo);
        const stratifier =
          [...multi, ...binary].find(
            (c) =>
              c !== outcomeBinary &&
              c !== exposureBinary &&
              c.levels.length >= 2 &&
              c.levels.length <= 5 &&
              STRAT_HINT.test(c.name),
          ) ??
          [...multi, ...binary].find(
            (c) =>
              c !== outcomeBinary &&
              c !== exposureBinary &&
              c.levels.length >= 2 &&
              c.levels.length <= 5,
          );
        if (stratifier) {
          subgroups = buildSubgroups(outcomeBinary, exposureBinary, stratifier) ?? undefined;
        }
      }
    }

    // --- Numeric outcome comparisons --------------------------------------
    const numericOutcome =
      numeric.find((c) => OUTCOME_HINT.test(c.name) && c !== timeColumn) ??
      numeric.find((c) => c !== timeColumn);
    if (numericOutcome) {
      const groupBinary = exposureBinary ?? binary[0];
      if (groupBinary) {
        analyses.push(...buildGroupComparison(numericOutcome, groupBinary));
      }
      const factor = multi.find((c) => EXPOSURE_HINT.test(c.name)) ?? multi[0];
      if (factor) {
        const anova = buildAnova(numericOutcome, factor);
        if (anova) analyses.push(anova);
      }
      const otherNumeric = numeric.find((c) => c !== numericOutcome && c !== timeColumn);
      if (otherNumeric && analyses.length === 0 && !survival) {
        const correlation = buildPearson(otherNumeric, numericOutcome);
        if (correlation) analyses.push(correlation);
      }
    }

    // Baseline characteristics table — every other variable compared across the
    // two levels of the grouping column (the outcome, else the exposure, else the
    // first binary column), the way a clinical paper opens with Table 1.
    const baselineGroup = outcomeBinary ?? exposureBinary ?? binary[0];
    if (baselineGroup) baseline = buildBaselineCharacteristics(columns, baselineGroup) ?? undefined;

    if (analyses.length === 0 && !survival) {
      notes.push('No pair of columns matched a supported analysis (a 2×2 table, group comparison, ANOVA, correlation, or survival model). Only descriptive statistics are reported.');
    }
  } catch {
    return {
      generated: false,
      analyses: [],
      notes: ['The inferential analysis could not be derived from this dataset; only descriptive statistics are reported.'],
    };
  }

  // Risk scores — always evaluated, independent of inferential tests
  const riskAnalysis = buildRiskScoreAnalysis(headers, rows);
  if (riskAnalysis) {
    analyses.push(riskAnalysis);
  }

  return {
    generated: analyses.length > 0 || subgroups !== undefined || survival !== undefined || baseline !== undefined,
    analyses,
    ...(baseline ? { baseline } : {}),
    ...(subgroups ? { subgroups } : {}),
    ...(survival ? { survival } : {}),
    notes,
  };
}
