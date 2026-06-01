// Pure vector math for semantic similarity. No deps — fully unit-testable.
// Vectors from the embedding provider are normalised, so cosineSim collapses to
// a dot product in practice; we still guard the general case for safety.

export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

export function magnitude(a: Float32Array): number {
  return Math.sqrt(dot(a, a));
}

/** Cosine similarity in [-1, 1]; 0 on length mismatch or a zero vector. */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  const ma = magnitude(a);
  const mb = magnitude(b);
  if (ma === 0 || mb === 0) return 0;
  return dot(a, b) / (ma * mb);
}

/** L2-normalise a vector to unit length (in place-safe copy). */
export function normalize(a: Float32Array): Float32Array {
  const m = magnitude(a);
  if (m === 0) return a;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i]! / m;
  return out;
}
