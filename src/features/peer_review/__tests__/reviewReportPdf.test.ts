import { describe, expect, it } from 'vitest';
import { plainText } from '../reviewReportPdf';

describe('plainText — peer-review PDF text sanitiser', () => {
  it('strips markdown emphasis so asterisks do not leak into the PDF', () => {
    // The real bug: the report printed "**SCORE:**" and "**OVERUSED WORDS**"
    // with the asterisks visible, because jsPDF does not parse markdown.
    expect(plainText('**SCORE:** 3/10')).toBe('SCORE: 3/10');
    expect(plainText('**OVERUSED WORDS**')).toBe('OVERUSED WORDS');
    expect(plainText('use *substantial* here')).toBe('use substantial here');
  });

  it('cleans mismatched markers like "*Issues Identified**"', () => {
    expect(plainText('*Issues Identified in PART/1 (Abstract)**')).toBe(
      'Issues Identified in PART/1 (Abstract)',
    );
    expect(plainText('*Originality Assessment**')).toBe('Originality Assessment');
  });

  it('folds the suggestion arrow to ASCII instead of rendering garbage', () => {
    // "→" is not in WinAnsi, so the standard PDF font drew it as a stray "!'".
    expect(plainText('“significant” → “substantial”')).toBe('“significant” -> “substantial”');
    expect(plainText('p ≥ 0.05 and OR ≤ 1.2')).toBe('p >= 0.05 and OR <= 1.2');
  });

  it('preserves WinAnsi punctuation the standard font can draw', () => {
    // Curly quotes, en/em dashes and the ellipsis are CP1252 characters and
    // rendered fine already — they must survive untouched.
    expect(plainText('“quote” – dash — 704…')).toBe('“quote” – dash — 704…');
  });

  it('drops other characters the standard font cannot draw rather than emit garbage', () => {
    // A CJK character has no WinAnsi glyph; drop it instead of printing a box.
    expect(plainText('effect 効果 size')).toBe('effect  size');
  });

  it('leaves plain text and single underscores untouched', () => {
    expect(plainText('recurrent VTE risk_factor analysis')).toBe(
      'recurrent VTE risk_factor analysis',
    );
  });
});
