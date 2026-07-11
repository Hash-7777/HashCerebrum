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

  // The real leak: the abstract/results carried out-of-bracket markers the
  // bracketed renumber pass never saw — "(S6)", "(S4, S9, S14)", "Source S18".
  it('rebrackets a single parenthetical source marker', () => {
    expect(expandCitationMarkers('a study of 148 participants (S6).', 40)).toBe(
      'a study of 148 participants [S6].',
    );
  });

  it('rebrackets and expands a parenthetical source group', () => {
    expect(expandCitationMarkers('three primary records (S4, S9, S14) dominate', 40)).toBe(
      'three primary records [S4][S9][S14] dominate',
    );
  });

  it('rebrackets a prose "Source S#" reference', () => {
    expect(expandCitationMarkers('Source S18 provided an odds ratio', 40)).toBe(
      '[S18] provided an odds ratio',
    );
    expect(expandCitationMarkers('extracted from source S7, suggesting', 40)).toBe(
      'extracted from [S7], suggesting',
    );
  });

  it('never rewrites an ordinary numeric parenthetical', () => {
    // Requiring the internal "S" prefix keeps statistics and counts safe.
    expect(expandCitationMarkers('148 participants (p = 0.04) and (2) arms', 40)).toBe(
      '148 participants (p = 0.04) and (2) arms',
    );
  });
});
