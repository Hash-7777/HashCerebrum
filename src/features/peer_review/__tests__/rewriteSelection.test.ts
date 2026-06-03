import { describe, expect, it } from 'vitest';
import { buildRewritePrompt, extractMarkers, markersPreserved } from '../rewriteSelection';

describe('extractMarkers', () => {
  it('collects distinct markers in sorted order', () => {
    expect(extractMarkers('A [3], B [1], C [3] again [12].')).toEqual([1, 3, 12]);
  });
  it('returns empty for marker-free text', () => {
    expect(extractMarkers('No citations here.')).toEqual([]);
  });
});

describe('markersPreserved', () => {
  it('passes when the same markers appear', () => {
    expect(markersPreserved('risk rises [1][2]', 'There is a higher risk [2][1].')).toBe(true);
  });
  it('fails when a marker is dropped', () => {
    expect(markersPreserved('risk rises [1][2]', 'risk rises [1]')).toBe(false);
  });
  it('fails when a marker is added', () => {
    expect(markersPreserved('risk rises [1]', 'risk rises [1][9]')).toBe(false);
  });
});

describe('buildRewritePrompt', () => {
  it('includes the register instruction and the passage', () => {
    const p = buildRewritePrompt('The drug works [1].', 'plain');
    expect(p).toContain('plain language');
    expect(p).toContain('The drug works [1].');
  });
});
