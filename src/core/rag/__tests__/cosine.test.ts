import { describe, expect, it } from 'vitest';
import { cosineSim, normalize } from '../search/cosine';

describe('cosineSim', () => {
  it('is 1 for identical vectors', () => {
    const a = normalize(Float32Array.from([3, 4]));
    expect(cosineSim(a, a)).toBeCloseTo(1, 6);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSim(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBe(0);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSim(Float32Array.from([1, 1]), Float32Array.from([-1, -1]))).toBeCloseTo(-1, 6);
  });

  it('is 0 on a length mismatch or a zero vector', () => {
    expect(cosineSim(Float32Array.from([1, 2, 3]), Float32Array.from([1, 2]))).toBe(0);
    expect(cosineSim(new Float32Array(3), Float32Array.from([1, 2, 3]))).toBe(0);
  });
});
