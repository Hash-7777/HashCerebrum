import { describe, expect, it } from 'vitest';
import { normalizeExtractedPdfText } from '../peerReviewStore';

describe('normalizeExtractedPdfText', () => {
  it('reflows lopdf fragment-per-line output into paragraphs', () => {
    const raw = [
      'Community pharmacists are an',
      'underutilized yet readily',
      'accessible resource for asthma',
      'management.',
      '',
      'A cross-sectional survey was',
      'conducted across 12 pharmacies.',
    ].join('\n');
    const out = normalizeExtractedPdfText(raw);
    expect(out).toBe(
      'Community pharmacists are an underutilized yet readily accessible resource for asthma management.\n\n' +
        'A cross-sectional survey was conducted across 12 pharmacies.',
    );
  });

  it('rejoins a hyphen stranded on its own line and de-hyphenates splits', () => {
    expect(normalizeExtractedPdfText('A Cross\n-\nSectional Study.')).toBe('A Cross-Sectional Study.');
    expect(normalizeExtractedPdfText('an under-\nutilized resource.')).toBe('an underutilized resource.');
  });
});
