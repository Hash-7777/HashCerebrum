import { describe, expect, it } from 'vitest';
import { setPlatform, type Platform } from '@platform/index';
import { fetchFullText } from '../index';

// Inject a platform whose only relevant method is europepmcFulltext.
function withFulltext(fn: (source: string, id: string) => Promise<string>): void {
  setPlatform({ medical: { europepmcFulltext: fn } } as unknown as Platform);
}

describe('fetchFullText', () => {
  it('returns the cleaned full text when available', async () => {
    withFulltext(async () => 'The full body text of the article. Methods and results here.');
    const out = await fetchFullText({ source: 'PMC', id: 'PMC123' });
    expect(out).toContain('full body text of the article');
  });

  it('returns null when no open-access full text exists (platform rejects)', async () => {
    withFulltext(async () => {
      throw new Error('upstream returned HTTP 404');
    });
    expect(await fetchFullText({ source: 'PMC', id: 'PMC999' })).toBeNull();
  });

  it('returns null for empty source or id without calling the platform', async () => {
    let called = false;
    withFulltext(async () => {
      called = true;
      return 'x';
    });
    expect(await fetchFullText({ source: '', id: 'PMC1' })).toBeNull();
    expect(await fetchFullText({ source: 'PMC', id: '   ' })).toBeNull();
    expect(called).toBe(false);
  });

  it('returns null when the full text is blank', async () => {
    withFulltext(async () => '   \n  ');
    expect(await fetchFullText({ source: 'PMC', id: 'PMC2' })).toBeNull();
  });
});
