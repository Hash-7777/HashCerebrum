// Numerical special functions and probability-distribution CDFs for the
// inferential statistics engine. Pure, dependency-free, deterministic.
//
// Every p-value the engine reports is computed here. The algorithms are the
// standard ones (Lanczos log-gamma, Lentz continued fractions for the
// regularized incomplete beta and gamma functions, Acklam's inverse-normal),
// and distributions.test.ts pins them against known reference values.

const ITMAX = 300; // continued-fraction / series iteration cap
const EPS = 1e-14; // relative convergence tolerance
const FPMIN = 1e-300; // smallest non-zero magnitude used to avoid div-by-zero

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? 1 : 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// --- Log-gamma (Lanczos, g = 7) ---------------------------------------------

const LANCZOS_G = 7;
const LANCZOS_COEF = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Natural log of the gamma function, valid for x > 0. */
export function logGamma(x: number): number {
  if (x <= 0) return Number.NaN;
  // Reflection is unnecessary here — every caller passes x > 0.
  let sum = LANCZOS_COEF[0]!;
  for (let i = 1; i < LANCZOS_G + 2; i += 1) sum += LANCZOS_COEF[i]! / (x + i - 1);
  const t = x + LANCZOS_G - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x - 0.5) * Math.log(t) - t + Math.log(sum);
}

// --- Regularized lower incomplete gamma P(a, x) -----------------------------

/** Series expansion for P(a, x), used when x < a + 1. */
function gammaSeries(a: number, x: number): number {
  let ap = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < ITMAX; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/** Lentz continued fraction for Q(a, x) = 1 - P(a, x), used when x >= a + 1. */
function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= ITMAX; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Regularized lower incomplete gamma function P(a, x). */
export function incompleteGammaP(a: number, x: number): number {
  if (x <= 0 || a <= 0) return 0;
  return x < a + 1 ? clampProbability(gammaSeries(a, x)) : clampProbability(1 - gammaContinuedFraction(a, x));
}

/** Regularized upper incomplete gamma function Q(a, x) = 1 - P(a, x). */
export function incompleteGammaQ(a: number, x: number): number {
  return clampProbability(1 - incompleteGammaP(a, x));
}

// --- Regularized incomplete beta I_x(a, b) ----------------------------------

/** Lentz continued fraction for the regularized incomplete beta function. */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= ITMAX; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  // Use whichever tail converges fastest.
  if (x < (a + 1) / (a + b + 2)) {
    return clampProbability((front * betaContinuedFraction(a, b, x)) / a);
  }
  return clampProbability(1 - (front * betaContinuedFraction(b, a, 1 - x)) / b);
}

// --- Error function ---------------------------------------------------------

/** Gauss error function erf(x). */
export function erf(x: number): number {
  if (x === 0) return 0;
  const value = incompleteGammaP(0.5, x * x);
  return x > 0 ? value : -value;
}

/** Complementary error function erfc(x) = 1 - erf(x). */
export function erfc(x: number): number {
  return 1 - erf(x);
}

// --- Standard normal --------------------------------------------------------

/** Standard normal cumulative distribution function P(Z <= z). */
export function normalCdf(z: number): number {
  // Z^2 ~ chi-square(1); P(chi2_1 <= z^2) = P(1/2, z^2/2).
  const half = 0.5 * incompleteGammaP(0.5, (z * z) / 2);
  return clampProbability(z >= 0 ? 0.5 + half : 0.5 - half);
}

/** Standard normal survival function P(Z > z). */
export function normalSf(z: number): number {
  return clampProbability(1 - normalCdf(z));
}

/** Two-sided standard normal p-value for a z statistic: P(|Z| >= |z|). */
export function normalTwoSidedP(z: number): number {
  return clampProbability(2 * normalSf(Math.abs(z)));
}

// Acklam's rational approximation to the inverse normal CDF.
const ACKLAM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
];
const ACKLAM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1,
];
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783,
];
const ACKLAM_D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
  3.754408661907416,
];

/** Inverse standard normal CDF (quantile / probit) for 0 < p < 1. */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const low = 0.02425;
  const high = 1 - low;
  let q: number;
  let r: number;
  if (p < low) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((ACKLAM_C[0]! * q + ACKLAM_C[1]!) * q + ACKLAM_C[2]!) * q + ACKLAM_C[3]!) * q + ACKLAM_C[4]!) * q +
        ACKLAM_C[5]!) /
      ((((ACKLAM_D[0]! * q + ACKLAM_D[1]!) * q + ACKLAM_D[2]!) * q + ACKLAM_D[3]!) * q + 1)
    );
  }
  if (p > high) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((ACKLAM_C[0]! * q + ACKLAM_C[1]!) * q + ACKLAM_C[2]!) * q + ACKLAM_C[3]!) * q + ACKLAM_C[4]!) * q +
        ACKLAM_C[5]!) /
      ((((ACKLAM_D[0]! * q + ACKLAM_D[1]!) * q + ACKLAM_D[2]!) * q + ACKLAM_D[3]!) * q + 1)
    );
  }
  q = p - 0.5;
  r = q * q;
  return (
    ((((((ACKLAM_A[0]! * r + ACKLAM_A[1]!) * r + ACKLAM_A[2]!) * r + ACKLAM_A[3]!) * r + ACKLAM_A[4]!) * r +
      ACKLAM_A[5]!) *
      q) /
    (((((ACKLAM_B[0]! * r + ACKLAM_B[1]!) * r + ACKLAM_B[2]!) * r + ACKLAM_B[3]!) * r + ACKLAM_B[4]!) * r + 1)
  );
}

// --- Student's t ------------------------------------------------------------

/** Student's t cumulative distribution function P(T <= t) with df degrees of freedom. */
export function studentTCdf(t: number, df: number): number {
  if (df <= 0) return Number.NaN;
  if (t === 0) return 0.5;
  // betai(df/2, 1/2, df/(df+t^2)) is the two-tailed area P(|T| >= |t|).
  const tail = incompleteBeta(df / 2, 0.5, df / (df + t * t));
  return clampProbability(t > 0 ? 1 - 0.5 * tail : 0.5 * tail);
}

/** Two-sided p-value for a t statistic: P(|T| >= |t|). */
export function tTwoSidedP(t: number, df: number): number {
  if (df <= 0 || !Number.isFinite(t)) return Number.NaN;
  return clampProbability(incompleteBeta(df / 2, 0.5, df / (df + t * t)));
}

/**
 * Inverse Student's t CDF (quantile) for 0 < p < 1. Found by bisection on the
 * monotone CDF — used to build confidence intervals around t statistics.
 */
export function studentTQuantile(p: number, df: number): number {
  if (df <= 0) return Number.NaN;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  let lo = -1e7;
  let hi = 1e7;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// --- F distribution ---------------------------------------------------------

/** F cumulative distribution function P(F <= f) with (d1, d2) degrees of freedom. */
export function fCdf(f: number, d1: number, d2: number): number {
  if (f <= 0 || d1 <= 0 || d2 <= 0) return 0;
  return clampProbability(1 - incompleteBeta(d2 / 2, d1 / 2, d2 / (d2 + d1 * f)));
}

/** Upper-tail p-value for an F statistic: P(F >= f). */
export function fUpperP(f: number, d1: number, d2: number): number {
  if (f <= 0 || d1 <= 0 || d2 <= 0) return 1;
  return clampProbability(incompleteBeta(d2 / 2, d1 / 2, d2 / (d2 + d1 * f)));
}

// --- Chi-square -------------------------------------------------------------

/** Chi-square cumulative distribution function P(X <= x) with df degrees of freedom. */
export function chiSquareCdf(x: number, df: number): number {
  if (x <= 0 || df <= 0) return 0;
  return clampProbability(incompleteGammaP(df / 2, x / 2));
}

/** Upper-tail p-value for a chi-square statistic: P(X >= x). */
export function chiSquareUpperP(x: number, df: number): number {
  if (x <= 0 || df <= 0) return 1;
  return clampProbability(incompleteGammaQ(df / 2, x / 2));
}
