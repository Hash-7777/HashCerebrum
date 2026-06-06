import { describe, expect, it } from 'vitest';
import { metaAnalyse, forestPlotData } from '../metaAnalysis';

describe('metaAnalysis', () => {
  it('requires at least 2 studies', () => {
    const r = metaAnalyse([{ id: '1', effectSize: 0.5, se: 0.1 }]);
    expect(r).toHaveProperty('error');
  });

  it('pools two studies correctly', () => {
    const studies = [
      { id: 'a', effectSize: 0.4, se: 0.1 },
      { id: 'b', effectSize: 0.6, se: 0.15 },
    ];
    const r = metaAnalyse(studies) as any;
    expect(r.error).toBeUndefined();
    expect(r.pooledEffect).toBeGreaterThan(0.4);
    expect(r.pooledEffect).toBeLessThan(0.6);
    expect(r.ciLower).toBeLessThan(r.pooledEffect);
    expect(r.ciUpper).toBeGreaterThan(r.pooledEffect);
    expect(r.studies).toBe(2);
  });

  it('computes I2 and tau2', () => {
    const studies = [
      { id: 'a', effectSize: 0.3, se: 0.05 },
      { id: 'b', effectSize: 0.5, se: 0.05 },
      { id: 'c', effectSize: 0.7, se: 0.05 },
    ];
    const r = metaAnalyse(studies) as any;
    expect(r.i2).toBeGreaterThanOrEqual(0);
    expect(r.i2).toBeLessThanOrEqual(100);
    expect(r.tau2).toBeGreaterThanOrEqual(0);
    expect(r.qStatistic).toBeGreaterThan(0);
  });

  it('generates forest plot data', () => {
    const studies = [
      { id: 'a', effectSize: 0.3, se: 0.1, label: 'Study A' },
      { id: 'b', effectSize: 0.5, se: 0.1, label: 'Study B' },
    ];
    const r = metaAnalyse(studies) as any;
    const data = forestPlotData(studies, r);
    expect(data).toHaveLength(3);
    expect(data[data.length - 1]!.id).toBe('pooled');
  });
});
