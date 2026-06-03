import { describe, expect, it } from 'vitest';
import { summarizeImport, type ImportReport } from '../importPdfs';

function report(p: Partial<ImportReport>): ImportReport {
  return { addedDocuments: 0, addedPassages: 0, duplicates: [], skipped: [], ...p };
}

describe('summarizeImport', () => {
  it('summarises additions, duplicates, and skips', () => {
    const s = summarizeImport(
      report({ addedDocuments: 2, addedPassages: 37, duplicates: ['a.pdf'], skipped: [{ name: 'b.pdf', reason: 'scanned' }] }),
    );
    expect(s).toContain('37 passages from 2 papers');
    expect(s).toContain('1 already in library');
    expect(s).toContain('1 skipped');
  });

  it('uses singular wording for a single paper/passage', () => {
    expect(summarizeImport(report({ addedDocuments: 1, addedPassages: 1 }))).toBe('Added 1 passage from 1 paper');
  });

  it('reports nothing to import when empty', () => {
    expect(summarizeImport(report({}))).toBe('Nothing to import.');
  });
});
