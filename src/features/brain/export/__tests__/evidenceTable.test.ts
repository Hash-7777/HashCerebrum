import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { buildEvidenceTableCsv } from '../evidenceTable';

function rec(partial: Partial<EvidenceItem> & { title: string }): EvidenceItem {
  return {
    source: 'pubmed',
    authors: [],
    identifiers: {},
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: 'h',
    ...partial,
  };
}

describe('buildEvidenceTableCsv', () => {
  it('emits a header and one row per record with a resolvable link', () => {
    const csv = buildEvidenceTableCsv([
      rec({
        title: 'SGLT2 inhibitors and MACE',
        year: 2024,
        snippet: 'A randomized controlled trial in adults with type 2 diabetes reported a hazard ratio of 0.86 (95% CI 0.80-0.93, p=0.006).',
        identifiers: { doi: '10.1/abc', pmid: '39112233' },
      }),
    ]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain('Marker,Title,Year');
    expect(lines[0]).toContain('Effect estimates');
    expect(lines[1]).toContain('[S1]');
    expect(lines[1]).toContain('SGLT2 inhibitors and MACE');
    expect(lines[1]).toContain('2024');
    // The bound effect is rendered with its CI.
    expect(lines[1]).toContain('0.86');
    expect(lines[1]).toContain('95% CI 0.80-0.93');
    // Best link resolves to the DOI.
    expect(lines[1]).toContain('https://doi.org/10.1/abc');
  });

  it('quotes a title containing a comma and neutralizes a formula-injection cell', () => {
    const csv = buildEvidenceTableCsv([rec({ title: '=cmd(), and more', source: 'europepmc' })]);
    // Comma-bearing title is wrapped in quotes and the leading = is escaped.
    expect(csv).toContain('"\'=cmd(), and more"');
  });
});
