import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { buildChatMarkdownExport, buildExportHtml, buildMarkdownExport, deriveDocumentTitle, escapeHtml, markdownToHtml, renumberCitations, stripGeneratedReferenceSections, stripResidualSourceMarkers } from '../messageExport';
import { slugifyFilename } from '@platform/download';
import { buildPublicationArtifact } from '../../swarm/publication';
import type { Manuscript } from '../../swarm/manuscript';
import type { EvidenceExtraction } from '../../swarm/publicationTypes';

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
    // authors. title. year. source. — and, when a link is resolvable, the whole
    // line is a clickable Markdown link to the real paper.
    const md = buildMarkdownExport(message);
    expect(md).toContain('1. [HashCerebrum test. Bleeding outcomes in anticoagulant users.');
    expect(md).toContain('](https://doi.org/10.0000/test)');
    const html = buildExportHtml(message);
    expect(html).toContain('<h2>References</h2>');
    // The reference links out to the resolved DOI URL.
    expect(html).toContain('href="https://doi.org/10.0000/test"');
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

  it('renumbers a multi-source group ([S25, S27]) instead of leaking it raw', () => {
    const pool = [...Array(30)].map((_, i) => ({ ...citations[0]!, title: `Source ${i + 1}` }));
    const { content, citations: cited } = renumberCitations(
      'Divergence noted [S25, S27]; and again [S25; S30].',
      pool,
    );
    expect(content).toBe('Divergence noted [1][2]; and again [1][3].');
    expect(content).not.toMatch(/S\d/);
    expect(cited.map((c) => c.title)).toEqual(['Source 25', 'Source 27', 'Source 30']);
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

describe('buildChatMarkdownExport', () => {
  const meta = { title: 'Test Chat', mode: 'brain', project: 'Demo', messageCount: 3 };

  it('includes metadata header and skips system messages', () => {
    const messages = [
      { id: '1', role: 'system' as const, content: 'You are a research assistant.' },
      { id: '2', role: 'user' as const, content: 'Hello?' },
      { id: '3', role: 'assistant' as const, content: 'Hi there.', modelLabel: 'GPT-4o' },
    ];
    const md = buildChatMarkdownExport(messages, meta);
    expect(md).toContain('# Chat Transcript: Test Chat');
    expect(md).toContain('**Mode:** brain');
    expect(md).toContain('**Project:** Demo');
    expect(md).toContain('**Messages:** 3');
    expect(md).not.toContain('system');
    expect(md).toContain('## Message 1 — user');
    expect(md).toContain('## Message 2 — assistant (GPT-4o)');
  });

  it('includes citations, errors, and critique metadata', () => {
    const messages = [
      {
        id: '1',
        role: 'assistant' as const,
        content: 'Result here.',
        modelLabel: 'Claude',
        citations: [
          {
            source: 'pubmed' as const,
            title: 'Metformin in PCOS',
            authors: ['Smith', 'Jones'],
            year: 2024,
            identifiers: {},
            fetchedAt: '2026-01-01T00:00:00Z',
            provenanceHash: 'abc',
          },
        ],
        error: 'Rate limited',
        critiqueOf: 'msg-0',
      },
    ];
    const md = buildChatMarkdownExport(messages, meta);
    expect(md).toContain('(Claude)');
    expect(md).toContain('### Citations');
    expect(md).toContain('Metformin in PCOS');
    expect(md).toContain('### Error');
    expect(md).toContain('Rate limited');
    expect(md).toContain('**Critique of message:** msg-0');
  });

  it('renumbers inline [S#] markers and drops dangling ones so body and list line up', () => {
    const rec = (title: string) => ({
      source: 'pubmed' as const,
      title,
      authors: ['A'],
      year: 2024,
      identifiers: {},
      fetchedAt: '2026-01-01T00:00:00Z',
      provenanceHash: title,
    });
    const messages = [
      {
        id: '1',
        role: 'assistant' as const,
        // Body cites S2, S1, and a dangling S9 with only two references available.
        content: 'First point [S2]. Second point [S1]. Dangling [S9].',
        citations: [rec('Ref one'), rec('Ref two')],
      },
    ];
    const md = buildChatMarkdownExport(messages, meta);
    // Markers are renumbered in citation order and the dangling one is removed.
    expect(md).toContain('First point [1]. Second point [2].');
    expect(md).not.toContain('[S2]');
    expect(md).not.toContain('[S9]');
    expect(md).not.toContain('Dangling [9]');
    // The reference list holds exactly the two cited refs, in first-appearance order.
    expect(md).toContain('1. A (2024). Ref two');
    expect(md).toContain('2. A (2024). Ref one');
  });

  it('includes manuscript and outline proposal metadata', () => {
    const messages = [
      {
        id: '1',
        role: 'assistant' as const,
        content: '',
        manuscript: {
          title: 'PCOS Review',
          abstract: { background: 'PCOS affects 10% of women.', objective: '', methods: '', results: '', conclusion: '', conclusions: '' },
          keywords: ['PCOS', 'metformin'],
          sections: [],
        },
      },
      {
        id: '2',
        role: 'user' as const,
        content: 'Draft this.',
        outlineProposal: { query: 'Write a review on PCOS' },
      },
    ];
    const md = buildChatMarkdownExport(messages, meta);
    expect(md).toContain('### Manuscript');
    expect(md).toContain('PCOS Review');
    expect(md).toContain('**Background:** PCOS affects 10% of women.');
    expect(md).toContain('**Keywords:** PCOS, metformin');
    expect(md).toContain('### Outline Proposal');
    expect(md).toContain('Write a review on PCOS');
  });

  it('skips empty messages with no content, manuscript, or outline', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: '   ' },
      { id: '2', role: 'assistant' as const, content: 'Answer.' },
      { id: '3', role: 'user' as const, content: '' },
    ];
    const md = buildChatMarkdownExport(messages, meta);
    // Whitespace-only and empty messages are skipped
    expect(md).toContain('## Message 1 — assistant');
    expect(md).not.toContain('## Message 2');
    expect(md.match(/## Message/g)).toHaveLength(1);
  });

  it('numbers messages sequentially regardless of skipped system messages', () => {
    const messages = [
      { id: 's1', role: 'system' as const, content: 'sys' },
      { id: 'u1', role: 'user' as const, content: 'Q1' },
      { id: 's2', role: 'system' as const, content: 'sys2' },
      { id: 'a1', role: 'assistant' as const, content: 'A1' },
    ];
    const md = buildChatMarkdownExport(messages, meta);
    expect(md).toContain('## Message 1 — user');
    expect(md).toContain('## Message 2 — assistant');
    expect(md).not.toContain('## Message 3');
  });

  it('renders execution trace for assistant messages that have one', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'What about metformin?' },
      {
        id: 'a1',
        role: 'assistant' as const,
        content: 'Metformin improves insulin sensitivity.',
        modelLabel: 'GPT-4',
        trace: [
          { agent: 'boss', phase: 'routing', detail: 'routing message' },
          { agent: 'boss', phase: 'delegating', detail: 'delegating to specialists' },
          { agent: 'evidence_synthesis', phase: 'start', detail: 'metformin insulin sensitivity' },
          { agent: 'evidence_synthesis', phase: 'tool_call', detail: 'pubmed_search' },
          { agent: 'evidence_synthesis', phase: 'tool_result', detail: 'pubmed_search: 12' },
          { agent: 'evidence_synthesis', phase: 'done', detail: '12 records' },
          { agent: 'boss', phase: 'synthesizing', detail: 'synthesizing specialist findings' },
        ],
      },
    ];
    const md = buildChatMarkdownExport(messages, meta);
    expect(md).toContain('### Execution Trace');
    expect(md).toContain('- **boss** · routing — routing message');
    expect(md).toContain('- **evidence_synthesis** · start — metformin insulin sensitivity');
    expect(md).toContain('- **evidence_synthesis** · tool_result — pubmed_search: 12');
    expect(md).toContain('- **evidence_synthesis** · done — 12 records');
    expect(md).toContain('- **boss** · synthesizing — synthesizing specialist findings');
  });

  it('does not render an empty trace section when trace is absent', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'Hello' },
      { id: 'a1', role: 'assistant' as const, content: 'Hi there.' },
    ];
    const md = buildChatMarkdownExport(messages, meta);
    expect(md).not.toContain('### Execution Trace');
  });
});

// Regression: the meta-analysis forest plot (and every figure that needs the
// pipeline's evidence extractions / claim ledger) was silently dropped from
// PDF / Word / Markdown export, because the export rebuilt the artifact with
// buildPublicationArtifact(manuscript, citations) — no extractions. The pipeline
// preserves those inputs on manuscript.publication; export must re-feed them.
describe('export preserves the computed pipeline figures', () => {
  function makeRatioExtraction(marker: string, keyFinding: string): EvidenceExtraction {
    return {
      id: marker,
      sourceMarker: marker,
      evidenceIndex: 0,
      source: 'pubmed',
      title: 'Test',
      year: '2024',
      identifiers: {},
      studyDesign: 'randomized clinical trial',
      population: 'adults with type 2 diabetes',
      exposureOrIntervention: 'SGLT2 inhibitor',
      comparator: 'placebo',
      outcomes: ['heart failure hospitalization'],
      sampleSize: 'n=1000',
      effectValues: [{ label: 'finding', value: '', sourceText: '' }],
      limitations: [],
      keyFinding,
      trusted: true,
    };
  }

  const extractions: EvidenceExtraction[] = [
    makeRatioExtraction('[S1]', 'hazard ratio 0.80 (95% CI 0.74-0.86)'),
    makeRatioExtraction('[S2]', 'hazard ratio 0.76 (95% CI 0.72 to 0.81)'),
    makeRatioExtraction('[S3]', 'hazard ratio 0.90 (95% CI 0.79-1.02)'),
  ];

  const evidence: EvidenceItem[] = [
    {
      source: 'pubmed',
      title: 'SGLT2 inhibitors and heart failure hospitalization',
      year: 2025,
      authors: ['HashCerebrum test'],
      identifiers: { pmid: '12345678' },
      snippet: 'Synthetic citation.',
      fetchedAt: new Date(0).toISOString(),
      provenanceHash: 'meta-export-test',
    },
  ];

  const baseManuscript: Manuscript = {
    title: 'SGLT2 Inhibitors and Heart Failure Hospitalization in Type 2 Diabetes',
    abstract: { background: 'b', objective: 'o', methods: 'm', results: 'r', conclusions: 'c' },
    keywords: ['sglt2 inhibitors'],
    sections: [
      { heading: 'Introduction', body: ['SGLT2 inhibitors reduce hospitalization [S1].'] },
      { heading: 'Discussion', body: ['The pooled estimate is protective [S1].'] },
    ],
  };

  it('carries the pooled forest plot into the Markdown export when extractions are preserved', () => {
    const publication = buildPublicationArtifact(baseManuscript, evidence, {
      evidenceExtractions: extractions,
    });
    // Sanity: the pipeline-built artifact really does contain the meta figure.
    expect(publication.figures.some((f) => f.kind === 'meta_analysis')).toBe(true);

    const md = buildMarkdownExport({
      title: baseManuscript.title,
      role: 'assistant',
      content: '',
      citations: evidence,
      manuscript: { ...baseManuscript, publication },
    });
    expect(md).toContain('Pooled quantitative synthesis');
  });

  it('omits the forest plot when the manuscript carries no extractions (data-driven, not always-on)', () => {
    const publication = buildPublicationArtifact(baseManuscript, evidence, {});
    const md = buildMarkdownExport({
      title: baseManuscript.title,
      role: 'assistant',
      content: '',
      citations: evidence,
      manuscript: { ...baseManuscript, publication },
    });
    expect(md).not.toContain('Pooled quantitative synthesis');
  });
});
