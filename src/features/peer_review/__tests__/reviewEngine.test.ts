import { describe, expect, it } from 'vitest';
import { parseReviewResponse, parseScore } from '../reviewEngine';

describe('parseScore', () => {
  it('reads the score even with markdown emphasis and spacing', () => {
    // The orchestrator writes "**SCORE:** 3 / 10"; the old regex missed it and
    // fell back to 5, causing the ring-vs-body mismatch.
    expect(parseScore('**SCORE:** 3 / 10')).toBe(3);
    expect(parseScore('SCORE: 7')).toBe(7);
    expect(parseScore('Overall **SCORE**: 8/10')).toBe(8);
  });

  it('falls back to 5 only when no score is present', () => {
    expect(parseScore('no score here')).toBe(5);
  });

  it('clamps to the 1–10 range', () => {
    expect(parseScore('SCORE: 0')).toBe(1);
    expect(parseScore('SCORE: 99')).toBe(10);
  });
});

describe('parseReviewResponse', () => {
  it('the parsed score matches a markdown-bold SCORE in the body (no mismatch)', () => {
    const raw = '**SCORE:** 3 / 10\n\nSUMMARY:\nThin statistics and no risk-of-bias appraisal.\n\nSTRENGTHS:\n- clear writing';
    expect(parseReviewResponse(raw, 'm').score).toBe(3);
  });
});
