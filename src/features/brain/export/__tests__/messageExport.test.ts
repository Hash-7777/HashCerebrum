import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { buildExportHtml, buildMarkdownExport, escapeHtml, markdownToHtml, slugifyFilename } from '../messageExport';

const citations: EvidenceItem[] = [
  {
    source: 'europepmc',
    title: 'Bleeding outcomes in anticoagulant users',
    year: 2026,
    authors: ['HashCerebrum test'],
    identifiers: { doi: '10.0000/test' },
    snippet: 'Synthetic citation.',
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: 'export-test',
  },
];

describe('message export helpers', () => {
  it('sanitizes HTML before rendering markdown-ish content', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    const html = markdownToHtml('## Results\n\n<script>alert("x")</script>\n\n- **Safe** item');

    expect(html).toContain('<h2>Results</h2>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('<strong>Safe</strong>');
    expect(html).not.toContain('<script>');
  });

  it('builds markdown and print HTML exports with evidence links', () => {
    const message = {
      title: 'NSAIDs and warfarin manuscript',
      role: 'assistant' as const,
      content: '# Manuscript Draft\n\nEvidence [S1].',
      modelLabel: 'Boss',
      citations,
    };

    expect(slugifyFilename(message.title)).toBe('nsaids-and-warfarin-manuscript');
    expect(buildMarkdownExport(message)).toContain('[S1] EUROPEPMC: Bleeding outcomes');
    expect(buildExportHtml(message)).toContain('Exported Evidence Links');
    expect(buildExportHtml(message)).toContain('DOI:10.0000/test');
  });
});
