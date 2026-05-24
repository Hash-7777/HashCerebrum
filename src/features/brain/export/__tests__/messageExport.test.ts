import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import {
  buildExportHtml,
  buildMarkdownExport,
  escapeHtml,
  markdownToHtml,
  renumberCitations,
  slugifyFilename,
  stripGeneratedReferenceSections,
} from '../messageExport';

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
    expect(buildMarkdownExport(message)).toContain('1. EUROPEPMC: Bleeding outcomes');
    const html = buildExportHtml(message);
    expect(html).toContain('<h2>References</h2>');
    // New citation format uses lowercase doi: with author name and italic title
    expect(html).toContain('10.0000/test');
    expect(html).toContain('Bleeding outcomes');
  });

  it('renumbers [S<n>] markers to sequential [1], [2], … by first appearance', () => {
    const fourth: EvidenceItem = { ...citations[0]!, title: 'Fourth source' };
    const ninth: EvidenceItem = { ...citations[0]!, title: 'Ninth source' };
    const pool = [...Array(8)].map((_, i) => ({ ...citations[0]!, title: `Source ${i + 1}` }));
    pool[3] = fourth;
    pool.push(ninth);
    const { content, citations: cited } = renumberCitations(
      'Claim one [S9]. Claim two [S4]. Claim three [S9] again.',
      pool,
    );
    expect(content).toBe('Claim one [1]. Claim two [2]. Claim three [1] again.');
    expect(cited.map((item) => item.title)).toEqual(['Ninth source', 'Fourth source']);
  });

  it('strips model-generated reference sections before appending canonical export references', () => {
    const content = [
      '## Results',
      'Evidence synthesis [S1].',
      '',
      '## References',
      '[S1] Duplicated model reference.',
    ].join('\n');
    const message = {
      title: 'Reference cleanup',
      role: 'assistant' as const,
      content,
      citations,
    };

    expect(stripGeneratedReferenceSections(content)).not.toContain('Duplicated model reference');
    const markdown = buildMarkdownExport(message);
    expect(markdown).toContain('Evidence synthesis [1].');
    expect(markdown).not.toContain('Duplicated model reference');
    expect(markdown).toContain('## References');
    expect(markdown.match(/## References/g)).toHaveLength(1);
    expect(markdownToHtml(content)).not.toContain('Duplicated model reference');
  });
});
