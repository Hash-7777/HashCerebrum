import { describe, expect, it } from 'vitest';
import { expandCitationMarkers } from '../citationMarkers';

describe('expandCitationMarkers', () => {
  it('leaves a single canonical marker untouched', () => {
    expect(expandCitationMarkers('text [S8] more', 40)).toBe('text [S8] more');
  });

  it('expands a comma-separated group (the leaked [S25, S27])', () => {
    expect(expandCitationMarkers('risk [S25, S27] noted', 40)).toBe('risk [S25][S27] noted');
  });

  it('expands a semicolon group and a three-item group', () => {
    expect(expandCitationMarkers('[S2; S3]', 40)).toBe('[S2][S3]');
    expect(expandCitationMarkers('[S2, S3, S6]', 40)).toBe('[S2][S3][S6]');
  });

  it('expands a range', () => {
    expect(expandCitationMarkers('[S1-S4]', 40)).toBe('[S1][S2][S3][S4]');
  });

  it('expands a mixed range and singletons', () => {
    expect(expandCitationMarkers('[S1-S3, S7]', 40)).toBe('[S1][S2][S3][S7]');
  });

  it('expands fullwidth brackets', () => {
    expect(expandCitationMarkers('【S2】', 40)).toBe('[S2]');
  });

  it('tolerates a dagger/asterisk footnote glyph the model appends', () => {
    // The real leak: Gemini / GPT-OSS emit 【S5†】, which failed the closing-bracket
    // match and leaked raw. Now normalised to [S5].
    expect(expandCitationMarkers('rise in INR【S5†】 noted', 40)).toBe('rise in INR[S5] noted');
    expect(expandCitationMarkers('effect [S6*] and [S8†]', 40)).toBe('effect [S6] and [S8]');
    expect(expandCitationMarkers('group 【S3†, S5†】', 40)).toBe('group [S3][S5]');
  });

  it('handles bare (non-S) numbers in a group', () => {
    expect(expandCitationMarkers('[4, 12]', 40)).toBe('[S4][S12]');
  });

  it('leaves a malformed huge range untouched', () => {
    expect(expandCitationMarkers('[S1-S9999]', 40)).toBe('[S1-S9999]');
  });

  it('does not touch non-citation bracketed text', () => {
    expect(expandCitationMarkers('an array [index] and [a, b]', 40)).toBe('an array [index] and [a, b]');
  });
});
