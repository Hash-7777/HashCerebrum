import { describe, expect, it } from 'vitest';
import { buildAskPrompt, chunkPaper, citedPassageNumbers, rankPassages } from '../askPaper';

describe('chunkPaper', () => {
  it('splits on blank lines and merges short fragments forward', () => {
    const text = 'Short one.\n\n' + 'B'.repeat(300) + '\n\n' + 'C'.repeat(300);
    const passages = chunkPaper(text);
    // "Short one." is under minChars so it merges into the next block.
    expect(passages).toHaveLength(2);
    expect(passages[0]!.text.startsWith('Short one.')).toBe(true);
    expect(passages[0]!.index).toBe(1);
  });
});

describe('rankPassages', () => {
  const passages = [
    { index: 1, text: 'Warfarin interacts with NSAIDs to raise bleeding risk substantially in patients.' },
    { index: 2, text: 'The study enrolled participants across several outpatient clinics over two years.' },
    { index: 3, text: 'Grapefruit juice inhibits intestinal CYP3A4 and elevates some drug concentrations.' },
  ];

  it('ranks the passage matching the query terms first and renumbers 1..k', () => {
    const ranked = rankPassages('bleeding risk with warfarin and NSAIDs', passages, 2);
    expect(ranked[0]!.text).toContain('Warfarin');
    expect(ranked[0]!.index).toBe(1);
    expect(ranked.length).toBeLessThanOrEqual(2);
  });

  it('drops passages with no overlap', () => {
    const ranked = rankPassages('grapefruit CYP3A4', passages, 6);
    expect(ranked.every((p) => !p.text.includes('outpatient clinics'))).toBe(true);
  });
});

describe('buildAskPrompt', () => {
  it('numbers passages and includes the question', () => {
    const prompt = buildAskPrompt('Does it raise bleeding?', [{ index: 1, text: 'Yes it does.' }]);
    expect(prompt).toContain('[P1] Yes it does.');
    expect(prompt).toContain('QUESTION: Does it raise bleeding?');
  });
});

describe('citedPassageNumbers', () => {
  it('extracts distinct passage markers in order', () => {
    expect(citedPassageNumbers('Bleeding rises [P2] and INR climbs [P2][P1].')).toEqual([2, 1]);
  });
});
