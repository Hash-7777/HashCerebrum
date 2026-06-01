import { describe, expect, it } from 'vitest';
import { pca3 } from '../pca3';

function dist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('pca3', () => {
  it('returns one 3D coordinate per input vector within the radius', () => {
    const vecs = [
      Float32Array.from([1, 0, 0, 0]),
      Float32Array.from([0, 1, 0, 0]),
      Float32Array.from([0, 0, 1, 0]),
    ];
    const out = pca3(vecs, 1);
    expect(out).toHaveLength(3);
    for (const p of out) for (const c of p) expect(Math.abs(c)).toBeLessThanOrEqual(1.0001);
  });

  it('places similar vectors closer than dissimilar ones (distance-faithful)', () => {
    // a and b are nearly identical; c is far in another direction.
    const a = Float32Array.from([1, 0, 0, 0, 0, 0]);
    const b = Float32Array.from([0.98, 0.02, 0, 0, 0, 0]);
    const c = Float32Array.from([0, 0, 0, 0, 1, 1]);
    const [pa, pb, pc] = pca3([a, b, c], 1) as [number, number, number][];
    expect(dist(pa!, pb!)).toBeLessThan(dist(pa!, pc!));
  });

  it('is deterministic across runs', () => {
    const vecs = Array.from({ length: 8 }, (_, i) => Float32Array.from([Math.sin(i), Math.cos(i), i % 3, i % 2]));
    expect(pca3(vecs)).toEqual(pca3(vecs));
  });

  it('handles the empty and single-vector cases', () => {
    expect(pca3([])).toEqual([]);
    expect(pca3([Float32Array.from([1, 2, 3])])).toHaveLength(1);
  });
});
