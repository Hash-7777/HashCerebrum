import { describe, expect, it } from 'vitest';
import { parseBlocks, splitPdfTextToSize } from '../paperPdf';

describe('paper PDF markdown parsing', () => {
  it('converts markdown tables into list blocks instead of raw pipe paragraphs', () => {
    const blocks = parseBlocks(`
## Clinical Trials

| Record | Design & Population | Primary Objective |
|---|---|---|
| [S1] CTGOV 2014 | healthy volunteer PK study | assess AUC and Cmax |
| [S2] CTGOV 2023 | crossover interaction study | evaluate co-administration |

Interpretation remains source-grounded [S1].
`);

    const texts = blocks.map((block) => ('text' in block ? block.text : '')).join('\n');
    expect(blocks.filter((block) => block.kind === 'bullet')).toHaveLength(2);
    expect(texts).toContain('Record: [S1] CTGOV 2014; Design & Population: healthy volunteer PK study');
    expect(texts).toContain('Record: [S2] CTGOV 2023; Design & Population: crossover interaction study');
    expect(texts).not.toContain('|');
    expect(texts).not.toContain('---');
  });
});

describe('paper PDF text wrapping', () => {
  it('breaks long unspaced identifiers before they can overflow the page', () => {
    const doc = {
      splitTextToSize: (text: string) => [text],
      getTextWidth: (text: string) => text.length * 5,
    };
    const lines = splitPdfTextToSize(
      doc,
      'Reference https://example.org/research/supplement/verylongunbrokentokenabcdefghijklmnopqrstuvwxyz0123456789.pdf',
      120,
    );

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => doc.getTextWidth(line) <= 120)).toBe(true);
  });
});
