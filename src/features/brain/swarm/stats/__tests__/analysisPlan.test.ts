import { describe, expect, it } from 'vitest';
import type { SubgroupAnalysis } from '../../publicationTypes';
import { deriveAnalysisPlan } from '../analysisPlan';
import { forestPlotFigure } from '../forestPlot';

/** Build headers + rows from parallel column arrays. */
function dataset(columns: Record<string, string[]>): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const headers = Object.keys(columns);
  const length = columns[headers[0]!]!.length;
  const rows = Array.from({ length }, (_, i) => {
    const row: Record<string, string> = {};
    for (const header of headers) row[header] = columns[header]![i]!;
    return row;
  });
  return { headers, rows };
}

function repeat(value: string, n: number): string[] {
  return Array.from({ length: n }, () => value);
}

describe('deriveAnalysisPlan — baseline characteristics (Table 1)', () => {
  it('compares every variable across the outcome groups with mean±SD / n(%) and a p-value', () => {
    // A MICA-style dataset: a complication outcome, a numeric biomarker higher in
    // the complication group, and a genotype categorical variable.
    const complication = [...repeat('yes', 10), ...repeat('no', 10)];
    const hba1c = [
      '8.1', '8.3', '8.0', '8.5', '8.2', '8.4', '8.1', '8.6', '8.0', '8.3',
      '7.1', '7.3', '7.0', '7.5', '7.2', '7.4', '7.1', '6.9', '7.0', '7.3',
    ];
    const genotype = [
      ...repeat('TT', 6), ...repeat('CT', 3), 'CC',
      ...repeat('CC', 6), ...repeat('CT', 3), 'TT',
    ];
    const { headers, rows } = dataset({ complication, hba1c, genotype });
    const plan = deriveAnalysisPlan(headers, rows);

    expect(plan.baseline).toBeDefined();
    const b = plan.baseline!;
    expect(b.groupColumn).toBe('complication');
    expect(b.groupALabel).toBe('yes');
    expect(b.groupBLabel).toBe('no');
    expect(b.nA).toBe(10);
    expect(b.nB).toBe(10);

    const hba1cRow = b.rows.find((r) => r.variable === 'hba1c');
    expect(hba1cRow).toBeDefined();
    expect(hba1cRow!.groupA).toContain('±');
    expect(hba1cRow!.groupA.startsWith('8')).toBe(true);
    expect(hba1cRow!.groupB.startsWith('7')).toBe(true);
    expect(hba1cRow!.pValue).not.toBeNull();
    expect(hba1cRow!.pValue!).toBeLessThan(0.05);
    expect(hba1cRow!.test).toContain('Welch');

    // Genotype renders one n(%) row per level and carries a categorical test.
    const ttRow = b.rows.find((r) => r.variable === 'genotype = TT');
    expect(ttRow).toBeDefined();
    expect(ttRow!.groupA).toMatch(/\d+ \(\d+\.\d%\)/);
  });
});

describe('deriveAnalysisPlan — 2×2 with subgroups', () => {
  it('runs a two-by-two analysis and a Mantel–Haenszel subgroup analysis', () => {
    const treatment = [...repeat('treated', 10), ...repeat('control', 10)];
    const outcome = [
      ...repeat('event', 3),
      ...repeat('none', 7),
      ...repeat('event', 7),
      ...repeat('none', 3),
    ];
    const sex = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 'M' : 'F'));
    const { headers, rows } = dataset({ treatment, outcome, sex });
    const plan = deriveAnalysisPlan(headers, rows);

    expect(plan.generated).toBe(true);
    const twoByTwo = plan.analyses.find((a) => a.kind === 'two_by_two');
    expect(twoByTwo).toBeDefined();
    // a=3, b=7, c=7, d=3 → OR = 9/49.
    expect(twoByTwo!.estimate!.point).toBeCloseTo(9 / 49, 4);
    expect(twoByTwo!.pValue).toBeGreaterThan(0);
    expect(plan.subgroups).toBeDefined();
    expect(plan.subgroups!.rows).toHaveLength(2);
    expect(plan.subgroups!.stratifier).toBe('sex');
  });
});

describe('deriveAnalysisPlan — numeric outcome by group', () => {
  it('runs Welch t and Mann–Whitney for a numeric outcome and a binary group', () => {
    const { headers, rows } = dataset({
      arm: [...repeat('active', 6), ...repeat('placebo', 6)],
      score: ['12', '14', '13', '15', '11', '16', '8', '9', '7', '10', '8', '9'],
    });
    const plan = deriveAnalysisPlan(headers, rows);
    expect(plan.analyses.map((a) => a.kind)).toContain('welch_t');
    expect(plan.analyses.map((a) => a.kind)).toContain('mann_whitney');
  });
});

describe('deriveAnalysisPlan — ANOVA', () => {
  it('runs one-way ANOVA for a numeric outcome across a multi-level factor', () => {
    const { headers, rows } = dataset({
      region: [...repeat('north', 4), ...repeat('south', 4), ...repeat('east', 4)],
      measure: ['10', '11', '12', '9', '20', '21', '19', '22', '30', '31', '29', '32'],
    });
    const plan = deriveAnalysisPlan(headers, rows);
    const anova = plan.analyses.find((a) => a.kind === 'anova');
    expect(anova).toBeDefined();
    expect(anova!.pValue).toBeLessThan(0.05);
  });
});

describe('deriveAnalysisPlan — survival', () => {
  it('detects time and event columns and runs survival analysis', () => {
    const { headers, rows } = dataset({
      followup_months: ['10', '12', '8', '15', '20', '18', '4', '6', '3', '8', '5', '7'],
      death: [
        'alive', 'dead', 'alive', 'dead', 'alive', 'alive',
        'dead', 'dead', 'dead', 'alive', 'dead', 'dead',
      ],
      arm: [...repeat('treated', 6), ...repeat('control', 6)],
      age: ['55', '60', '48', '62', '50', '58', '65', '70', '52', '59', '61', '68'],
    });
    const plan = deriveAnalysisPlan(headers, rows);
    expect(plan.survival).toBeDefined();
    expect(plan.survival!.timeColumn).toBe('followup_months');
    expect(plan.survival!.eventColumn).toBe('death');
    expect(plan.survival!.medianSurvival.length).toBeGreaterThanOrEqual(1);
    expect(plan.survival!.logRank).toBeDefined();
  });
});

describe('deriveAnalysisPlan — honest empty plan', () => {
  it('returns an ungenerated plan with a note when no columns are suitable', () => {
    const { headers, rows } = dataset({
      record_id: Array.from({ length: 10 }, (_, i) => String(i + 1)),
      comment: Array.from({ length: 10 }, (_, i) => `free text remark number ${i}`),
    });
    const plan = deriveAnalysisPlan(headers, rows);
    expect(plan.generated).toBe(false);
    expect(plan.analyses).toHaveLength(0);
    expect(plan.notes.length).toBeGreaterThan(0);
  });
});

describe('forestPlotFigure', () => {
  it('renders a forest-plot SVG figure from a subgroup analysis', () => {
    const subgroup: SubgroupAnalysis = {
      outcome: 'event',
      exposure: 'treatment',
      stratifier: 'sex',
      rows: [
        { label: 'sex: M', oddsRatio: 0.5, ciLow: 0.2, ciHigh: 1.2, n: 30 },
        { label: 'sex: F', oddsRatio: 0.8, ciLow: 0.3, ciHigh: 2.0, n: 25 },
      ],
      pooledOddsRatio: 0.62,
      pooledCiLow: 0.34,
      pooledCiHigh: 1.1,
      homogeneityP: 0.41,
      reportText: 'Pooled odds ratio 0.62.',
    };
    const figure = forestPlotFigure(subgroup);
    expect(figure.kind).toBe('forest_plot');
    expect(figure.id).toBe('fig-forest-plot');
    expect(figure.svg.startsWith('<svg')).toBe(true);
    expect(figure.svg).toContain('<polygon'); // the pooled-estimate diamond
  });
});
