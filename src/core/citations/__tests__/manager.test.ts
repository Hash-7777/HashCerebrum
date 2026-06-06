import { describe, expect, it } from 'vitest';
import { importItems, getLibrary, findByDoi, exportRis } from '../manager';

describe('citation manager', () => {
  it('imports items', () => {
    const count = importItems([
      { id: '1', source: 'manual', title: 'Paper One', authors: ['A B'], tags: [], importedAt: '' },
    ]);
    expect(count).toBe(1);
    expect(getLibrary()).toHaveLength(1);
  });

  it('finds by DOI', () => {
    importItems([
      { id: '2', source: 'manual', title: 'Paper Two', authors: ['C D'], doi: '10.1234/x', tags: [], importedAt: '' },
    ]);
    const found = findByDoi('10.1234/x');
    expect(found?.title).toBe('Paper Two');
  });

  it('exports RIS', () => {
    const ris = exportRis([
      { id: '3', source: 'manual', title: 'Test', authors: ['E F'], year: 2024, doi: '10.1/1', tags: [], importedAt: '' },
    ]);
    expect(ris).toContain('TY  - JOUR');
    expect(ris).toContain('TI  - Test');
    expect(ris).toContain('DO  - 10.1/1');
  });
});
