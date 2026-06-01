import { describe, expect, it } from 'vitest';
import { chooseK, clusterLabel, kmeans } from '../cluster';

// Build a unit vector that lives near one of three orthogonal directions, with
// a little deterministic jitter, so the three groups are genuinely separable.
function near(axis: 0 | 1 | 2, jitter: number): Float32Array {
  const v = new Float32Array(8);
  v[axis] = 1;
  v[(axis + 1) % 8] = jitter;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i += 1) v[i] = v[i]! / norm;
  return v;
}

describe('kmeans clustering', () => {
  it('recovers three well-separated groups', () => {
    const vectors = [
      near(0, 0.02), near(0, 0.05), near(0, 0.01),
      near(1, 0.03), near(1, 0.04), near(1, 0.02),
      near(2, 0.01), near(2, 0.05), near(2, 0.03),
    ];
    const { assignments, k } = kmeans(vectors, 3, 7);
    expect(k).toBe(3);
    // Each true group must land in a single cluster.
    expect(new Set(assignments.slice(0, 3)).size).toBe(1);
    expect(new Set(assignments.slice(3, 6)).size).toBe(1);
    expect(new Set(assignments.slice(6, 9)).size).toBe(1);
    // The three groups must be distinct clusters.
    expect(new Set([assignments[0], assignments[3], assignments[6]]).size).toBe(3);
  });

  it('is deterministic for the same seed and data', () => {
    const vectors = [near(0, 0.02), near(1, 0.03), near(2, 0.01), near(0, 0.04)];
    expect(kmeans(vectors, 3, 11).assignments).toEqual(kmeans(vectors, 3, 11).assignments);
  });

  it('drops empty clusters and reports real sizes', () => {
    const vectors = [near(0, 0.01), near(0, 0.02)];
    const res = kmeans(vectors, 5, 1); // ask for more clusters than points
    expect(res.k).toBeLessThanOrEqual(2);
    expect(res.sizes.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('chooseK scales with size and stays in range', () => {
    expect(chooseK(2)).toBe(2);
    expect(chooseK(8)).toBe(2);
    expect(chooseK(800)).toBe(10);
    expect(chooseK(50)).toBeGreaterThanOrEqual(2);
    expect(chooseK(50)).toBeLessThanOrEqual(10);
  });

  it('labels a cluster by its most frequent meaningful terms', () => {
    const label = clusterLabel([
      'warfarin bleeding risk in NSAIDs',
      'warfarin and NSAIDs interaction',
      'warfarin dosing pediatric',
    ]);
    expect(label.toLowerCase()).toContain('warfarin');
    // Stopwords / meta terms must not be chosen.
    expect(label.toLowerCase()).not.toContain('risk');
  });
});
