import { describe, expect, it } from 'vitest';
import {
  pairedTTest,
  wilcoxonSignedRank,
  mcnemarTest,
  diagnosticAccuracy,
  rocAuc,
  cohensD,
  cramersV,
  bonferroni,
  holmBonferroni,
  benjaminiHochberg,
} from '../inference';

describe('Paired t-test', () => {
  it('detects significant change', () => {
    const before = [120, 122, 118, 125, 119];
    const after = [110, 115, 112, 118, 111];
    const r = pairedTTest(before, after);
    expect(r).not.toBeNull();
    expect(r!.meanDifference).toBeGreaterThan(0);
    expect(r!.pValue).toBeLessThan(0.05);
  });

  it('returns null for mismatched lengths', () => {
    expect(pairedTTest([1, 2], [1])).toBeNull();
  });
});

describe('Wilcoxon signed-rank', () => {
  it('runs on paired non-normal data', () => {
    const before = [10, 12, 15, 18, 20];
    const after = [8, 11, 14, 19, 21];
    const r = wilcoxonSignedRank(before, after);
    expect(r).not.toBeNull();
    expect(r!.n).toBe(5);
  });
});

describe('McNemar', () => {
  it('tests paired binary change', () => {
    const before = [true, true, false, false, true, false];
    const after = [true, false, true, false, true, true];
    const r = mcnemarTest(before, after);
    expect(r).not.toBeNull();
    expect(r!.discordantA + r!.discordantB).toBeGreaterThan(0);
  });
});

describe('Diagnostic accuracy', () => {
  it('computes Sens/Spec/PPV/NPV', () => {
    const r = diagnosticAccuracy(90, 10, 80, 20);
    expect(r).not.toBeNull();
    expect(r!.sensitivity).toBeCloseTo(0.818, 2);
    expect(r!.specificity).toBeCloseTo(0.889, 2);
    expect(r!.ppv).toBeCloseTo(0.9, 2);
    expect(r!.npv).toBeCloseTo(0.8, 2);
  });

  // Regression: LR- was computed as (1 - specificity) / sensitivity — the
  // reciprocal of LR+, not LR- at all. Both operands were the wrong quantity.
  it('reports the textbook likelihood ratios', () => {
    // tp=90 fn=10 -> sens 0.90; tn=80 fp=20 -> spec 0.80
    const r = diagnosticAccuracy(90, 20, 80, 10);
    expect(r!.sensitivity).toBeCloseTo(0.9, 6);
    expect(r!.specificity).toBeCloseTo(0.8, 6);
    // LR+ = 0.90 / (1 - 0.80) = 4.5
    expect(r!.lrPositive).toBeCloseTo(4.5, 6);
    // LR- = (1 - 0.90) / 0.80 = 0.125.  The old formula gave 0.222.
    expect(r!.lrNegative).toBeCloseTo(0.125, 6);
    expect(r!.lrNegative).not.toBeCloseTo(0.222, 2);
  });

  it('gives a perfectly sensitive test an LR- of zero rather than NaN', () => {
    // sens = 1 rules the disease out on a negative result — the single most
    // useful case, which the old `sens < 1` guard suppressed to NaN.
    const r = diagnosticAccuracy(50, 10, 90, 0);
    expect(r!.sensitivity).toBe(1);
    expect(r!.lrNegative).toBe(0);
  });
});

describe('ROC AUC', () => {
  it('computes from two groups', () => {
    const pos = [0.8, 0.9, 0.85, 0.95, 0.7];
    const neg = [0.3, 0.4, 0.2, 0.5, 0.35];
    const r = rocAuc(pos, neg);
    expect(r).not.toBeNull();
    expect(r!.auc).toBeGreaterThan(0.5);
    expect(r!.auc).toBeLessThanOrEqual(1);
  });

  // Regression: AUC was derived from the SMALLER of the two U values, which
  // forced every result to 0.5 or above. An inverse marker was reported as its
  // own mirror image, reversing the direction of the finding.
  it('reports AUC below 0.5 when the positive group scores lower', () => {
    const pos = [0.2, 0.3, 0.1, 0.25, 0.15];
    const neg = [0.8, 0.9, 0.7, 0.85, 0.95];
    const r = rocAuc(pos, neg);
    expect(r).not.toBeNull();
    expect(r!.auc).toBe(0); // perfectly separated, the wrong way round
  });

  it('mirrors exactly when the groups are swapped', () => {
    const pos = [5, 6, 7, 1];
    const neg = [2, 3, 4, 8];
    const forward = rocAuc(pos, neg)!.auc;
    const reversed = rocAuc(neg, pos)!.auc;
    expect(forward + reversed).toBeCloseTo(1, 10);
  });

  it('returns 0.5 for two identical distributions', () => {
    const a = [1, 2, 3, 4];
    const b = [1, 2, 3, 4];
    expect(rocAuc(a, b)!.auc).toBeCloseTo(0.5, 10);
  });
});

describe("Cohen's d", () => {
  it('measures standardized mean difference', () => {
    const a = [100, 102, 98, 105, 99];
    const b = [90, 92, 88, 95, 91];
    const r = cohensD(a, b);
    expect(r).not.toBeNull();
    expect(Math.abs(r!.d)).toBeGreaterThan(1);
  });
});

describe("Cramer's V", () => {
  it('measures association strength', () => {
    const table = [[50, 30], [20, 40]];
    const r = cramersV(table);
    expect(r).not.toBeNull();
    expect(r!.v).toBeGreaterThan(0);
    expect(r!.v).toBeLessThanOrEqual(1);
  });
});

describe('Multiple comparison correction', () => {
  const pValues = [0.01, 0.04, 0.1, 0.5];

  it('Bonferroni is most conservative', () => {
    const r = bonferroni(pValues);
    expect(r.adjusted[0]!).toBeCloseTo(0.04, 5);
    expect(r.rejected[0]!).toBe(true);
    expect(r.rejected[2]!).toBe(false);
  });

  it('Holm is less conservative than Bonferroni', () => {
    const b = bonferroni(pValues);
    const h = holmBonferroni(pValues);
    // Holm adjusted p-values should be <= Bonferroni for the same index
    expect(h.adjusted[2]!).toBeLessThanOrEqual(b.adjusted[2]!);
  });

  it('BH-FDR controls false discovery rate', () => {
    const r = benjaminiHochberg(pValues);
    expect(r.adjusted.every((p) => p <= 1)).toBe(true);
    expect(r.adjusted.every((p) => p >= 0)).toBe(true);
  });
});
