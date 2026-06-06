// Sample-size and power calculators for common biomedical designs.

const Z_ALPHA = 1.96; // two-sided alpha = 0.05
const Z_BETA = 0.84;  // power = 0.80

/**
 * Sample size for comparing two independent proportions.
 */
export function sampleSizeProportions(p1: number, p2: number): number {
  const p = (p1 + p2) / 2;
  const delta = Math.abs(p1 - p2);
  if (delta === 0) return Infinity;
  const num = 2 * p * (1 - p) * (Z_ALPHA + Z_BETA) ** 2;
  return Math.ceil(num / (delta * delta));
}

/**
 * Sample size per group for two-sample t-test (equal allocation).
 */
export function sampleSizeTTest(meanDiff: number, sd: number): number {
  if (meanDiff === 0 || sd <= 0) return Infinity;
  const num = 2 * sd * sd * (Z_ALPHA + Z_BETA) ** 2;
  return Math.ceil(num / (meanDiff * meanDiff));
}

/**
 * Sample size for survival analysis (log-rank) with equal allocation.
 * @param hazardRatio HR to detect
 * @param eventRate Overall event rate (0–1)
 */
export function sampleSizeSurvival(hazardRatio: number, eventRate: number): number {
  if (hazardRatio <= 0 || eventRate <= 0) return Infinity;
  const logHR = Math.log(hazardRatio);
  const num = 4 * (Z_ALPHA + Z_BETA) ** 2;
  const eventsNeeded = Math.ceil(num / (logHR * logHR));
  return Math.ceil(eventsNeeded / eventRate);
}

/**
 * Sample size for one-way ANOVA (k groups).
 */
export function sampleSizeAnova(k: number, meanDiff: number, sd: number): number {
  if (k < 2 || meanDiff === 0 || sd <= 0) return Infinity;
  const num = 2 * k * sd * sd * (Z_ALPHA + Z_BETA) ** 2;
  return Math.ceil(num / (meanDiff * meanDiff));
}
