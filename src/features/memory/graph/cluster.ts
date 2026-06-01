// Deterministic k-means clustering of stored embedding vectors. Pure and
// dependency-free. This is what lets the memory map show *real* semantic
// groups: nodes are coloured by the cluster their actual embedding falls into
// (genuine k-means on the high-dimensional vectors), not by an arbitrary
// per-query label. Embeddings are L2-normalised, so squared-Euclidean distance
// is monotonic with cosine distance — k-means on it recovers cosine clusters.

export interface ClusterResult {
  /** Cluster index assigned to each input vector (same order as input). */
  assignments: number[];
  /** Number of clusters actually produced (empty clusters are dropped). */
  k: number;
  /** Member count per final cluster index. */
  sizes: number[];
  /** Cluster centroids, parallel to the final cluster indices. */
  centroids: Float64Array[];
}

// Seeded LCG so clustering is stable across renders/sessions for the same data.
function seededRng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function sqDist(a: Float32Array, b: Float64Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]! - b[i]!;
    d += x * x;
  }
  return d;
}

/**
 * A sensible cluster count for `n` findings: ~sqrt(n/2), clamped to [2, 10] so
 * the legend stays readable and tiny memories still split into a few groups.
 */
export function chooseK(n: number): number {
  if (n < 4) return Math.max(1, n);
  return Math.max(2, Math.min(10, Math.round(Math.sqrt(n / 2))));
}

/**
 * Deterministic k-means with seeded k-means++ initialisation and Lloyd
 * iterations. Returns compacted clusters (empty ones removed). O(n·k·dim·iters).
 */
export function kmeans(vectors: Float32Array[], k: number, seed = 1, maxIters = 24): ClusterResult {
  const n = vectors.length;
  if (n === 0) return { assignments: [], k: 0, sizes: [], centroids: [] };
  const dim = vectors[0]!.length;
  const kk = Math.max(1, Math.min(k, n));
  const rng = seededRng(seed);

  // ── k-means++ seeding: spread the initial centroids by distance² weighting.
  const centroids: Float64Array[] = [];
  const first = Math.floor(rng() * n);
  centroids.push(Float64Array.from(vectors[first]!));
  const dist2 = new Float64Array(n).fill(Infinity);
  while (centroids.length < kk) {
    const last = centroids[centroids.length - 1]!;
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      const d = sqDist(vectors[i]!, last);
      if (d < dist2[i]!) dist2[i] = d;
      total += dist2[i]!;
    }
    if (total <= 0) break; // all points coincide with a centroid
    let target = rng() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i += 1) {
      target -= dist2[i]!;
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    centroids.push(Float64Array.from(vectors[pick]!));
  }

  // ── Lloyd iterations: assign → recompute, until assignments settle.
  const assignments = new Array<number>(n).fill(0);
  for (let iter = 0; iter < maxIters; iter += 1) {
    let moved = false;
    for (let i = 0; i < n; i += 1) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = sqDist(vectors[i]!, centroids[c]!);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        moved = true;
      }
    }
    // Recompute centroids as the mean of their members.
    const sums = centroids.map(() => new Float64Array(dim));
    const counts = new Array<number>(centroids.length).fill(0);
    for (let i = 0; i < n; i += 1) {
      const c = assignments[i]!;
      counts[c] = (counts[c] ?? 0) + 1;
      const sum = sums[c]!;
      const v = vectors[i]!;
      for (let d = 0; d < dim; d += 1) sum[d]! += v[d]!;
    }
    for (let c = 0; c < centroids.length; c += 1) {
      if (counts[c] === 0) continue;
      const sum = sums[c]!;
      const cent = centroids[c]!;
      for (let d = 0; d < dim; d += 1) cent[d] = sum[d]! / counts[c]!;
    }
    if (!moved && iter > 0) break;
  }

  // ── Compact away empty clusters so indices are contiguous and small.
  const used = new Map<number, number>();
  const finalCentroids: Float64Array[] = [];
  for (let c = 0; c < centroids.length; c += 1) {
    if (assignments.some((a) => a === c)) {
      used.set(c, finalCentroids.length);
      finalCentroids.push(centroids[c]!);
    }
  }
  const remapped = assignments.map((a) => used.get(a) ?? 0);
  const sizes = new Array<number>(finalCentroids.length).fill(0);
  for (const a of remapped) sizes[a] = (sizes[a] ?? 0) + 1;

  return { assignments: remapped, k: finalCentroids.length, sizes, centroids: finalCentroids };
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was', 'were', 'has', 'have', 'had',
  'not', 'but', 'all', 'any', 'can', 'use', 'used', 'using', 'into', 'than', 'then', 'such', 'who',
  'study', 'studies', 'review', 'effect', 'effects', 'analysis', 'results', 'result', 'data', 'full',
  'paper', 'research', 'about', 'patients', 'patient', 'clinical', 'evidence', 'associated', 'risk',
]);

/**
 * Derive a short human label for a cluster from its members' titles/queries —
 * the most frequent meaningful terms. Used for the map legend so each coloured
 * group is named by what it actually contains rather than "cluster 3".
 */
export function clusterLabel(texts: string[], maxWords = 2): string {
  const freq = new Map<string, number>();
  for (const text of texts) {
    const seen = new Set<string>();
    for (const raw of text.toLowerCase().split(/[^a-z0-9-]+/)) {
      const w = raw.trim();
      if (w.length < 4 || STOP.has(w) || seen.has(w)) continue;
      seen.add(w);
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxWords)
    .map(([w]) => w);
  if (top.length === 0) return 'misc';
  return top.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' · ');
}
