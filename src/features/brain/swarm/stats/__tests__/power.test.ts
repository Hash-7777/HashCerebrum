import { describe, expect, it } from 'vitest';
import { sampleSizeProportions, sampleSizeTTest, sampleSizeSurvival, sampleSizeAnova } from '../power';

describe('power analysis', () => {
  it('proportions sample size', () => {
    const n = sampleSizeProportions(0.3, 0.5);
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it('t-test sample size', () => {
    const n = sampleSizeTTest(5, 10);
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it('survival sample size', () => {
    const n = sampleSizeSurvival(0.7, 0.4);
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it('ANOVA sample size', () => {
    const n = sampleSizeAnova(3, 5, 10);
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });
});
