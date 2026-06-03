import { describe, expect, it } from 'vitest';
import {
  chunkDocument,
  cleanPdfText,
  deriveDocMeta,
  hashBytes,
  textQuality,
} from '../ingest/pdfImport';

describe('cleanPdfText', () => {
  it('rejoins hyphenated line breaks and reflows wrapped lines into paragraphs', () => {
    const raw = 'Anticoagulation with war-\nfarin needs close\nmonitoring.\n\nNSAIDs raise risk.';
    const out = cleanPdfText(raw);
    expect(out).toContain('warfarin needs close monitoring.');
    expect(out.split('\n\n').length).toBe(2);
  });

  it('drops stray page-number lines', () => {
    const raw = 'A real sentence ends here.\n\n12\n\nAnother sentence follows.';
    const out = cleanPdfText(raw);
    expect(out).not.toMatch(/(^|\n)12(\n|$)/);
    expect(out).toContain('Another sentence follows.');
  });

  it('strips control characters', () => {
    const out = cleanPdfText('Clean\x00 text\x07 here.');
    expect(out).not.toMatch(/[\x00\x07]/);
    expect(out).toContain('Clean text here.');
  });
});

describe('textQuality', () => {
  it('flags too little text as scanned/empty', () => {
    expect(textQuality('short').ok).toBe(false);
  });
  it('accepts a real paragraph', () => {
    const good = 'This is a genuine paragraph of readable medical text. '.repeat(6);
    expect(textQuality(cleanPdfText(good)).ok).toBe(true);
  });
  it('flags low alphanumeric ratio as unreadable', () => {
    const junk = '@#$%^&*()_+{}|:<>?'.repeat(40);
    expect(textQuality(junk).ok).toBe(false);
  });
});

describe('deriveDocMeta', () => {
  it('extracts a title line, year, and DOI', () => {
    const text =
      'Warfarin and NSAID Bleeding Risk in Older Adults\nJohn Smith et al. 2021\ndoi:10.1001/jama.2021.12345\n\nAbstract...';
    const meta = deriveDocMeta('paper.pdf', text);
    expect(meta.title).toBe('Warfarin and NSAID Bleeding Risk in Older Adults');
    expect(meta.year).toBe(2021);
    expect(meta.doi).toBe('10.1001/jama.2021.12345');
  });

  it('falls back to a de-slugged filename when no title line is found', () => {
    const meta = deriveDocMeta('my_study_2020.pdf', '123\n456\n');
    expect(meta.title).toBe('my study 2020');
  });
});

describe('chunkDocument', () => {
  it('keeps passages within the target size and indexes them', () => {
    const para = 'Sentence about evidence. '.repeat(20); // ~500 chars
    const text = [para, para, para].join('\n\n');
    const chunks = chunkDocument(text, { targetChars: 600, overlapChars: 80, minChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 800)).toBe(true);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it('hard-splits a paragraph longer than the target on sentence boundaries', () => {
    const huge = 'This is one sentence. '.repeat(120); // ~2640 chars, no blank lines
    const chunks = chunkDocument(huge, { targetChars: 600 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 800)).toBe(true);
  });

  it('returns a single chunk for short text', () => {
    expect(chunkDocument('Just a short note about a drug interaction.')).toHaveLength(1);
  });
});

describe('hashBytes', () => {
  it('is stable for identical bytes and differs for different bytes', async () => {
    const a = await hashBytes(new Uint8Array([1, 2, 3, 4]));
    const b = await hashBytes(new Uint8Array([1, 2, 3, 4]));
    const c = await hashBytes(new Uint8Array([4, 3, 2, 1]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
