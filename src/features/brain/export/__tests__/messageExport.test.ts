import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import {
  buildExportHtml,
  buildMarkdownExport,
  deriveDocumentTitle,
  escapeHtml,
  markdownToHtml,
  renumberCitations,
  slugifyFilename,
  stripGeneratedReferenceSections,
  stripResidualSourceMarkers,
} from '../messageExport';

describe('deriveDocumentTitle', () => {
  it('skips a bare "**Title:**" label and uses the real title line', () => {
    const content = '**Title:**\n\nTitle: NSAIDs with Warfarin in Young Adults\n\nAbstract\n…';
    expect(deriveDocumentTitle(content, 'fallback')).toBe('NSAIDs with Warfarin in Young Adults');
  });

  it('strips a leading markdown heading and bold markers', () => {
    expect(deriveDocumentTitle('# **Metformin** in PCOS\nbody', 'fb')).toBe('Metformin in PCOS');
  });

  it('passes a clean first line through', () => {
    expect(deriveDocumentTitle('Statins and CoQ10\nmore', 'fb')).toBe('Statins and CoQ10');
  });

  it('falls back when there is no usable line', () => {
    expect(deriveDocumentTitle('\n\n   \n', 'HashCerebrum message 1')).toBe('HashCerebrum message 1');
    expect(deriveDocumentTitle('**Title:**', 'fb')).toBe('fb');
  });

  it('truncates a long title at a word boundary, never mid-phrase', () => {
    const long =
      '# Community Pharmacist-Led Interventions in Asthma Management and Inhaler Technique Education: An Evidence Review of Clinical Outcomes';
    const title = deriveDocumentTitle(long, 'fb');
    expect(title.length).toBeLessThanOrEqual(131); // 130 + ellipsis
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/\s$/); // no trailing space before the ellipsis
    // The cut lands on a whole word, not a sliced fragment.
    expect(title).toContain('Inhaler Technique Education');
  });
});

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
    // References now render in a proper scholarly style (Vancouver by default):
    // authors. title. year. source. — rather than the old "SOURCE: title".
    expect(buildMarkdownExport(message)).toContain('1. HashCerebrum test. Bleeding outcomes in anticoagulant users.');
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

  it('drops citation markers that do not resolve to a real retrieved record', () => {
    const pool = [citations[0]!, citations[0]!]; // only 2 records exist
    const { content, citations: cited } = renumberCitations(
      'Real claim [S1]. Hallucinated claim [S43]. Another real claim [S2].',
      pool,
    );
    // The phantom [S43] is removed; the surviving markers stay sequential and
    // every one of them maps to a record in the returned citation list.
    expect(content).toBe('Real claim [1]. Hallucinated claim. Another real claim [2].');
    expect(content).not.toContain('43');
    expect(cited).toHaveLength(2);
  });

  it('normalises bare S<n> markers glued to the preceding word', () => {
    const pool = [...Array(9)].map((_, i) => ({ ...citations[0]!, title: `Source ${i + 1}` }));
    // Some models drop the brackets and glue the marker to the word
    // (`inhibitionS8`, `CYP2 C19S9`). These must still renumber, gain a space,
    // and a space-separated stray like "S100" must be left untouched.
    const { content, citations: cited } = renumberCitations(
      'CYP2C19 inhibitionS8. Confirmed through CYP2 C19S9. Stray S100 stays.',
      pool,
    );
    expect(content).toBe(
      'CYP2C19 inhibition [1]. Confirmed through CYP2 C19 [2]. Stray S100 stays.',
    );
    expect(cited).toHaveLength(2);
  });

  it('normalises fullwidth/CJK bracket markers (【S2】) and renumbers them', () => {
    const pool = [...Array(5)].map((_, i) => ({ ...citations[0]!, title: `Source ${i + 1}` }));
    const { content } = renumberCitations(
      'Mechanism reported【S2】and confirmed〔S4〕again ［S2］.',
      pool,
    );
    expect(content).toBe('Mechanism reported[1]and confirmed[2]again [1].');
    expect(content).not.toMatch(/[【〔［】〕］]/);
    expect(content).not.toMatch(/S\d/);
  });

  it('expands citation ranges ([S1-S9], incl. unicode hyphens) before renumbering', () => {
    const pool = [...Array(9)].map((_, i) => ({ ...citations[0]!, title: `Source ${i + 1}` }));
    // ASCII hyphen, U+2011 non-breaking hyphen, and an en dash all expand.
    const { content, citations: cited } = renumberCitations(
      'Broadly supported [S1-S3]. Also [S5‑S6]. And 【S8–S9】.',
      pool,
    );
    expect(content).toBe('Broadly supported [1][2][3]. Also [4][5]. And [6][7].');
    expect(cited).toHaveLength(7);
    expect(content).not.toMatch(/S\d/);
  });

  it('guards against any residual bracketed marker leaking into the output', () => {
    const pool = [citations[0]!]; // only [S1] resolves
    const { content } = renumberCitations('Real [S1]. Phantom range 【S40-S44】 here.', pool);
    // The phantom fullwidth range neither resolves nor survives as text.
    expect(content).toBe('Real [1]. Phantom range here.');
    expect(content).not.toMatch(/[【】]|S\d/);
  });

  it('stripResidualSourceMarkers removes bracketed markers but keeps bare prose tokens', () => {
    expect(stripResidualSourceMarkers('Effect [S2] seen 【S3】.')).toBe('Effect seen.');
    expect(stripResidualSourceMarkers('Variant S100 stays.')).toBe('Variant S100 stays.');
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
