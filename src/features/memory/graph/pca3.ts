// Pure PCA → 3D projection of stored embedding vectors. This is what makes the
// memory map a *real* vector graph: each finding's position is the projection of
// its actual high-dimensional embedding onto the top 3 principal components, so
// proximity on screen reflects genuine semantic similarity — not a decorative
// layout.
//
// Deterministic (seeded power iteration), dependency-free, and distance-faithful
// (a single uniform scale is applied so the 3 axes keep their true relative
// spread rather than being independently stretched).

export type Vec3 = [number, number, number];

// Small seeded LCG so the projection is stable across renders/sessions.
function seededUnit(dim: number, seed: number): Float64Array {
  let state = (seed * 2654435761) >>> 0 || 1;
  const v = new Float64Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const x = state / 0xffffffff - 0.5;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i += 1) v[i] = v[i]! / norm;
  return v;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i]! * b[i]!;
  return s;
}

/**
 * Project N embedding vectors (all the same length) to N 3D coordinates via PCA.
 * Coordinates are uniformly scaled into roughly [-radius, radius].
 */
export function pca3(vectors: Float32Array[], radius = 1): Vec3[] {
  const n = vectors.length;
  if (n === 0) return [];
  const dim = vectors[0]!.length;
  if (dim === 0) return vectors.map(() => [0, 0, 0]);

  // Mean-centre the data (Float64 for numerical stability).
  const mean = new Float64Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i += 1) mean[i]! += v[i]!;
  for (let i = 0; i < dim; i += 1) mean[i]! /= n;
  const centred = vectors.map((v) => {
    const c = new Float64Array(dim);
    for (let i = 0; i < dim; i += 1) c[i] = v[i]! - mean[i]!;
    return c;
  });

  // Top-3 principal components via power iteration with Gram–Schmidt deflation.
  const components: Float64Array[] = [];
  for (let k = 0; k < 3; k += 1) {
    let vec = seededUnit(dim, k + 1);
    for (let iter = 0; iter < 40; iter += 1) {
      // Av = Σ_i (x_i · v) x_i  — covariance × v without forming the matrix.
      const av = new Float64Array(dim);
      for (const x of centred) {
        const d = dot(x, vec);
        for (let i = 0; i < dim; i += 1) av[i]! += d * x[i]!;
      }
      // Remove already-found components so this converges to the next PC.
      for (const c of components) {
        const d = dot(av, c);
        for (let i = 0; i < dim; i += 1) av[i]! -= d * c[i]!;
      }
      let norm = Math.sqrt(dot(av, av));
      if (norm < 1e-9) {
        vec = seededUnit(dim, k + 100 + iter);
        continue;
      }
      for (let i = 0; i < dim; i += 1) av[i]! /= norm;
      vec = av;
    }
    components.push(vec);
  }

  // Project and apply one uniform scale (keeps true relative distances).
  const raw: Vec3[] = centred.map((x) => [dot(x, components[0]!), dot(x, components[1]!), dot(x, components[2]!)]);
  let maxAbs = 0;
  for (const p of raw) for (const c of p) maxAbs = Math.max(maxAbs, Math.abs(c));
  const scale = maxAbs > 0 ? radius / maxAbs : 1;
  return raw.map(([x, y, z]) => [x * scale, y * scale, z * scale]);
}
