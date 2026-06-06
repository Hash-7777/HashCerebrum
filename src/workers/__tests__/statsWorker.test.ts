import { describe, expect, it } from 'vitest';

describe('stats worker algorithms', () => {
  it('Welch t-test computes t and df', () => {
    const a = [2.1, 2.5, 2.3, 2.9, 2.7];
    const b = [3.1, 3.5, 3.3, 3.9, 3.7];
    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = (arr: number[]) => {
      const m = mean(arr);
      return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
    };
    const m1 = mean(a), m2 = mean(b);
    const v1 = variance(a), v2 = variance(b);
    const se = Math.sqrt(v1 / a.length + v2 / b.length);
    const t = (m1 - m2) / se;
    expect(t).toBeLessThan(0);
    expect(Math.abs(t)).toBeGreaterThan(2);
  });

  it('Pearson r is 1 for perfectly correlated data', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    const mx = x.reduce((s, v) => s + v, 0) / x.length;
    const my = y.reduce((s, v) => s + v, 0) / y.length;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < x.length; i++) {
      const dx = x[i]! - mx;
      const dy = y[i]! - my;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    const r = num / Math.sqrt(dx2 * dy2);
    expect(r).toBeCloseTo(1, 5);
  });

  it('Chi-square on 2x2 table', () => {
    const table = [[10, 20], [30, 40]];
    const rowSums = table.map((r) => r.reduce((s, v) => s + v, 0));
    const colSums = [table[0]![0]! + table[1]![0]!, table[0]![1]! + table[1]![1]!];
    const total = rowSums.reduce((s, v) => s + v, 0);
    let chi2 = 0;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const expected = (rowSums[i]! * colSums[j]!) / total;
        const diff = table[i]![j]! - expected;
        chi2 += (diff * diff) / expected;
      }
    }
    expect(chi2).toBeGreaterThan(0);
    expect(Number.isFinite(chi2)).toBe(true);
  });

  it('Kaplan-Meier survival decreases monotonically', () => {
    const events = [
      { time: 1, event: 1 }, { time: 2, event: 0 },
      { time: 3, event: 1 }, { time: 4, event: 1 },
    ];
    const sorted = [...events].sort((a, b) => a.time - b.time);
    const survival: number[] = [];
    let n = sorted.length;
    let s = 1;
    let i = 0;
    while (i < sorted.length) {
      const t = sorted[i]!.time;
      let d = 0, c = 0;
      while (i < sorted.length && sorted[i]!.time === t) {
        if (sorted[i]!.event === 1) d++;
        else c++;
        i++;
      }
      if (d > 0) {
        s *= 1 - d / n;
        survival.push(s);
      }
      n -= d + c;
    }
    for (let k = 1; k < survival.length; k++) {
      expect(survival[k]!).toBeLessThanOrEqual(survival[k - 1]!);
    }
  });
});
