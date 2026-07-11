// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import type { Manuscript } from '../manuscript';
import type { UploadedDatasetSummary } from '../publicationTypes';
import {
  assertPublicationReady,
  buildPublicationArtifact,
  normalizeManuscriptForPublication,
  prismaFlowSvg,
  publicationMarkdown,
  referenceLinesForPublication,
  sanitizeSvgForHtml,
} from '../publication';

describe('prismaFlowSvg', () => {
  it('renders the four PRISMA stages with counts and exclusion side-boxes', () => {
    const svg = prismaFlowSvg(41, 38, 26, { 'Europe PMC': 20, PubMed: 15, OpenAlex: 6 });
    expect(svg).toContain('Records identified from databases (n = 41)');
    expect(svg).toContain('Records after duplicates removed (n = 38)');
    expect(svg).toContain('Records cited in the synthesis (n = 26)');
    // Exclusions are the differences: 41-38 duplicates, 38-26 not cited.
    expect(svg).toContain('Duplicate records removed: 3');
    expect(svg).toContain('Records not cited: 12');
    // Honest about being an automated, non-dual-reviewer screen.
    expect(svg).toContain('not a dual-reviewer PRISMA screen');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('never shows negative exclusion counts', () => {
    const svg = prismaFlowSvg(10, 10, 10, { PubMed: 10 });
    expect(svg).toContain('Duplicate records removed: 0');
    expect(svg).toContain('Records not cited: 0');
  });

  it('uses only tags the Typst PDF sanitizer allows, so the figure is not dropped', () => {
    // The Rust renderer (src-tauri/src/commands/manuscript.rs) sanitises each
    // figure SVG against a tag allowlist that does NOT include <marker>. A
    // marker-based arrow made the sanitizer silently drop the whole PRISMA
    // figure from the PDF. Arrowheads must be drawn as <path> triangles.
    const svg = prismaFlowSvg(41, 38, 26, { PubMed: 41 });
    expect(svg).not.toContain('<marker');
    expect(svg).not.toContain('marker-end');
    // Arrowheads are present, drawn as filled path triangles.
    expect(svg).toMatch(/<path d="M320 \d+ L\d+/); // downward flow arrows
    // Every tag used is on the renderer's allowlist.
    const allowed = new Set([
      'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
      'polygon', 'text', 'tspan', 'defs', 'use', 'clippath', 'mask',
      'lineargradient', 'radialgradient', 'stop', 'title', 'desc', 'style',
    ]);
    const tags = [...svg.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]!.toLowerCase());
    for (const tag of tags) expect(allowed.has(tag)).toBe(true);
  });
});
import { buildClaimLedger, extractEvidenceFromRecords } from '../paperPipeline';

const evidence: EvidenceItem[] = [
  {
    source: 'pubmed',
    title: 'Bleeding risk in anticoagulated patients',
    year: 2024,
    authors: ['A Researcher', 'B Clinician'],
    identifiers: { pmid: '12345', doi: '10.1000/bleed' },
    snippet: 'Warfarin patients exposed to interacting medicines had higher bleeding surveillance needs.',
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: 'pubmed-1',
  },
  {
    source: 'europepmc',
    title: 'Bleeding risk in anticoagulated patients',
    year: 2024,
    authors: ['A Researcher', 'B Clinician'],
    identifiers: { doi: '10.1000/bleed' },
    snippet: 'Duplicate source record.',
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: 'epmc-1',
  },
];

const manuscript: Manuscript = {
  title: 'Warfarin safety evidence review',
  abstract: {
    background: 'The evidence base describes anticoagulant safety signals [S1].',
    objective: 'To summarize source-grounded evidence [S1].',
    methods: 'The app searched guarded biomedical sources [S1].',
    results: 'Retrieved evidence was synthesized without model-invented statistics [S1].',
    conclusions: 'The draft requires expert review before use [S1].',
  },
  keywords: ['warfarin', 'safety'],
  sections: [
    {
      heading: 'Introduction',
      body: ['This intentionally short introduction cites two duplicate source records [S1] [S2].'],
    },
    {
      heading: 'Declarations',
      body: ['Automated evidence-review draft for expert review.'],
    },
  ],
};

describe('study-characteristics table (Table 1)', () => {
  const studyRecords: EvidenceItem[] = [
    {
      source: 'pubmed',
      title: 'ACE insertion/deletion polymorphism and venous thromboembolism risk',
      year: 2000,
      authors: ['González A'],
      identifiers: { pmid: '111' },
      snippet: 'A case-control study of 148 participants reported an odds ratio 0.53 (95% CI 0.30-0.94, p=0.04) for the ACE I/D polymorphism.',
      fetchedAt: new Date(0).toISOString(),
      provenanceHash: 'ace-1',
    },
    {
      source: 'pubmed',
      title: 'MTHFR C677T mutation with recurrent thrombosis: a case report',
      year: 2026,
      authors: ['Oh S'],
      identifiers: { pmid: '222' },
      snippet: 'A patient with the MTHFR C677T variant had recurrent events; no comparative effect estimate was reported.',
      fetchedAt: new Date(0).toISOString(),
      provenanceHash: 'mthfr-1',
    },
  ];

  it('lists each cited study with design, sample size and its reported effect', () => {
    const ms: Manuscript = {
      ...manuscript,
      sections: [
        { heading: 'Results', body: ['The ACE variant [S1] and the MTHFR case [S2] were reviewed.'] },
        { heading: 'Declarations', body: ['Automated evidence-review draft for expert review.'] },
      ],
    };
    const extractions = extractEvidenceFromRecords(studyRecords);
    const artifact = buildPublicationArtifact(ms, studyRecords, {
      evidenceExtractions: extractions,
      claimLedger: buildClaimLedger(extractions),
    });
    const table = artifact.tables.find((t) => t.id === 'table-study-characteristics');
    expect(table).toBeDefined();
    expect(table!.columns).toEqual(['Ref', 'Study', 'Year', 'Design', 'Sample size', 'Reported effect estimate']);
    // The ACE row shows its renumbered marker and its source-reported odds ratio.
    const aceRow = table!.rows.find((r) => r[1]!.includes('ACE'));
    expect(aceRow?.[0]).toBe('[1]');
    expect(aceRow?.[5]).toContain('0.53');
    // The MTHFR record reports no estimate — shown honestly, never borrowed.
    const mthfrRow = table!.rows.find((r) => r[1]!.includes('MTHFR'));
    expect(mthfrRow?.[5]).toBe('not reported');
  });

  it('plots individual estimates as a forest plot when they are not poolable', () => {
    const mixed: EvidenceItem[] = [
      {
        source: 'pubmed',
        title: 'ACE polymorphism and VTE odds',
        year: 2000,
        authors: ['González A'],
        identifiers: { pmid: '111' },
        snippet: 'The ACE I/D polymorphism showed an odds ratio 0.53 (95% CI 0.30-0.94) in 148 participants.',
        fetchedAt: new Date(0).toISOString(),
        provenanceHash: 'ace-1',
      },
      {
        source: 'pubmed',
        title: 'Factor V and recurrence hazard',
        year: 2012,
        authors: ['Smith J'],
        identifiers: { pmid: '333' },
        snippet: 'Recurrence carried a hazard ratio 2.10 (95% CI 1.20-3.70) among carriers.',
        fetchedAt: new Date(0).toISOString(),
        provenanceHash: 'fv-1',
      },
    ];
    const ms: Manuscript = {
      ...manuscript,
      sections: [
        { heading: 'Results', body: ['The ACE odds [S1] and the factor V hazard [S2] were reviewed.'] },
        { heading: 'Declarations', body: ['Automated evidence-review draft for expert review.'] },
      ],
    };
    const extractions = extractEvidenceFromRecords(mixed);
    const artifact = buildPublicationArtifact(ms, mixed, {
      evidenceExtractions: extractions,
      claimLedger: buildClaimLedger(extractions),
    });
    const forest = artifact.figures.find((f) => f.id === 'fig-reported-effects-forest');
    expect(forest).toBeDefined();
    expect(forest!.kind).toBe('forest_plot');
    expect(forest!.svg.startsWith('<svg')).toBe(true);
    // Individual estimates are drawn, and it is explicitly NOT pooled.
    expect(forest!.svg).toContain('0.53');
    expect(forest!.svg).toContain('2.10');
    expect(forest!.svg).not.toContain('Pooled');
    // Renderer allowlist safety: no <marker>, so the Typst PDF keeps the figure.
    expect(forest!.svg).not.toContain('<marker');
  });
});

describe('baseline characteristics table (dataset Table 1)', () => {
  it('renders as the leading dataset table with per-group columns and a p-value', () => {
    const dataset: UploadedDatasetSummary = {
      filename: 'patients.csv',
      sha256: 'hash',
      rows: 20,
      columns: ['complication', 'hba1c'],
      delimiter: ',',
      columnSummaries: [],
      previewRows: [],
      inferential: {
        generated: true,
        analyses: [],
        notes: [],
        baseline: {
          groupColumn: 'complication',
          groupALabel: 'yes',
          groupBLabel: 'no',
          nA: 10,
          nB: 10,
          rows: [{ variable: 'hba1c', groupA: '8.25 ± 0.20', groupB: '7.18 ± 0.19', pValue: 0.0001, test: "Welch's t-test" }],
        },
      },
    };
    const artifact = buildPublicationArtifact(manuscript, evidence, { dataset });
    const tableIds = artifact.tables.map((t) => t.id);
    expect(tableIds).toContain('table-baseline-characteristics');
    // It leads the dataset tables, before the raw descriptives.
    expect(tableIds.indexOf('table-baseline-characteristics')).toBeLessThan(
      tableIds.indexOf('table-dataset-descriptives'),
    );
    const table = artifact.tables.find((t) => t.id === 'table-baseline-characteristics')!;
    expect(table.columns).toEqual(['Characteristic', 'yes (n=10)', 'no (n=10)', 'p-value']);
    expect(table.rows[0]).toEqual(['hba1c', '8.25 ± 0.20', '7.18 ± 0.19', '<0.001']);
  });
});

describe('cohort characteristics (descriptives) table', () => {
  it('renders numeric variables as mean ± SD and categorical as n (%)', () => {
    const dataset: UploadedDatasetSummary = {
      filename: 'patients.csv',
      sha256: 'hash',
      rows: 100,
      columns: ['age', 'sex'],
      delimiter: ',',
      columnSummaries: [
        { name: 'age', type: 'numeric', nonMissing: 100, missing: 0, mean: 30.96, sd: 13.36, median: 29, min: 18, max: 70 },
        { name: 'sex', type: 'categorical', nonMissing: 100, missing: 0, levels: [{ value: 'M', count: 67 }, { value: 'F', count: 33 }] },
      ],
      previewRows: [],
    };
    const artifact = buildPublicationArtifact(manuscript, evidence, { dataset });
    const table = artifact.tables.find((t) => t.id === 'table-dataset-descriptives')!;
    expect(table.title).toBe('Cohort characteristics');
    expect(table.columns).toEqual(['Variable', 'N', 'Summary (mean ± SD or n (%))']);
    expect(table.rows.find((r) => r[0] === 'age')?.[2]).toContain('30.96 ± 13.36');
    expect(table.rows.find((r) => r[0] === 'sex')?.[2]).toContain('M: 67 (67.0%)');
    // Journal-style abbreviation note in the caption.
    expect(table.caption).toContain('Abbreviations: N, number of non-missing observations; SD, standard deviation.');
  });
});

describe('publication artifact contract', () => {
  it('deduplicates citations into Vancouver-style canonical references', () => {
    const artifact = buildPublicationArtifact(manuscript, evidence);

    expect(artifact.schemaVersion).toBe('hc.manuscript.v2');
    expect(artifact.references).toHaveLength(1);
    expect(artifact.citationMap.S1?.displayMarker).toBe('[1]');
    expect(artifact.citationMap.S2?.displayMarker).toBe('[1]');
    expect(referenceLinesForPublication(artifact)[0]?.marker).toBe('[1]');

    const normalized = normalizeManuscriptForPublication(manuscript, artifact);
    expect(normalized.abstract.background).toContain('[1]');
    expect(normalized.sections[0]?.body.join(' ')).not.toContain('[S1]');
  });

  it('drops an untitled cited record from the reference list', () => {
    const withUntitled: EvidenceItem[] = [
      { source: 'pubmed', title: 'A real titled study', year: 2024, authors: ['A'], identifiers: { pmid: '1' }, snippet: 'text', fetchedAt: new Date(0).toISOString(), provenanceHash: 'p1' },
      { source: 'pubmed', title: '   ', year: 2015, authors: ['B'], identifiers: { pmid: '2' }, snippet: 'text', fetchedAt: new Date(0).toISOString(), provenanceHash: 'p2' },
    ];
    const ms: Manuscript = {
      ...manuscript,
      sections: [{ heading: 'Introduction', body: ['Cites a real record [S1] and an untitled one [S2].'] }],
    };
    const artifact = buildPublicationArtifact(ms, withUntitled);
    expect(artifact.references).toHaveLength(1);
    expect(artifact.references[0]?.evidence.title).toBe('A real titled study');
    // The untitled record's marker resolves to nothing and is stripped from the body.
    const normalized = normalizeManuscriptForPublication(ms, artifact);
    expect(normalized.sections[0]?.body.join(' ')).not.toContain('[S2]');
  });

  it('normalizes legacy bare source markers into canonical references', () => {
    const artifact = buildPublicationArtifact(
      {
        ...manuscript,
        abstract: {
          ...manuscript.abstract,
          background: 'The legacy draft used a bare source marker [1].',
        },
        sections: [
          {
            heading: 'Introduction',
            body: ['The legacy draft cited duplicate records with bare markers [1] [2].'],
          },
          {
            heading: 'Declarations',
            body: ['Automated evidence-review draft for expert review.'],
          },
        ],
      },
      evidence,
    );

    expect(artifact.references).toHaveLength(1);
    expect(artifact.citationMap.S1?.displayMarker).toBe('[1]');
    const normalized = normalizeManuscriptForPublication(
      {
        ...manuscript,
        sections: [
          {
            heading: 'Introduction',
            body: ['The legacy draft cited duplicate records with bare markers [1] [2].'],
          },
          {
            heading: 'Declarations',
            body: ['Automated evidence-review draft for expert review.'],
          },
        ],
      },
      artifact,
      { includeSupplementalSection: false },
    );
    expect(normalized.sections[0]?.body.join(' ')).toContain('[1] [1]');
    expect(normalized.sections[0]?.body.join(' ')).not.toContain('[2]');
  });

  it('blocks publication export when required section depth is not met', () => {
    const artifact = buildPublicationArtifact(manuscript, evidence);

    expect(artifact.validation.exportReady).toBe(false);
    expect(artifact.validation.blockers.some((issue) => issue.code === 'section-too-short')).toBe(true);
    expect(() => assertPublicationReady(artifact)).toThrow(/publication validation/i);
  });

  it('flags a fabricated primary study (the tool only reviews literature)', () => {
    const fabricated: Manuscript = {
      ...manuscript,
      abstract: {
        ...manuscript.abstract,
        methods:
          'A retrospective cohort study was conducted using electronic health records; propensity-score matching was applied to balance baseline kidney function [S1].',
      },
    };
    const artifact = buildPublicationArtifact(fabricated, evidence);
    expect(artifact.validation.blockers.some((issue) => issue.code === 'fabricated-primary-study')).toBe(true);
  });

  it('does not flag a faithful evidence-review abstract as fabrication', () => {
    const artifact = buildPublicationArtifact(manuscript, evidence);
    expect(artifact.validation.blockers.some((issue) => issue.code === 'fabricated-primary-study')).toBe(false);
  });

  it('exports a markdown package with canonical references and SVG figure assets', () => {
    const artifact = buildPublicationArtifact(manuscript, evidence);
    const markdown = publicationMarkdown(manuscript, artifact);

    expect(markdown).toContain('## Figure SVG Assets');
    expect(markdown).toContain('<svg');
    expect(markdown).toContain('## References');
    // References are clickable: the marker precedes a Markdown link to the paper.
    expect(markdown).toContain('[1] [A Researcher, B Clinician');
    expect(markdown).toContain('](https://doi.org/10.1000/bleed)');
    expect(markdown).not.toContain('[S2]');
  });

  it('publishes only the PRISMA flow and data figures/tables — no search-about charts', () => {
    const extractions = extractEvidenceFromRecords([
      {
        source: 'pubmed',
        title: 'A randomized controlled trial of anticoagulant safety',
        year: 2024,
        authors: ['A Researcher'],
        identifiers: { pmid: '999' },
        snippet:
          'A randomized controlled trial enrolled 320 patients and reported an odds ratio of 1.8 (95% CI 1.2-2.6, p=0.004).',
        fetchedAt: new Date(0).toISOString(),
        provenanceHash: 'rct-1',
      },
    ]);
    const claimLedger = buildClaimLedger(extractions);
    const artifact = buildPublicationArtifact(manuscript, evidence, {
      evidenceExtractions: extractions,
      claimLedger,
    });
    const kinds = artifact.figures.map((figure) => figure.kind);
    // The PRISMA flow is the one search-provenance figure kept.
    expect(kinds).toContain('prisma_flow');
    // The search/extraction meta charts are gone so every other figure is data.
    expect(kinds).not.toContain('source_yield');
    expect(kinds).not.toContain('evidence_years');
    expect(kinds).not.toContain('evidence_strength');
    expect(kinds).not.toContain('numeric_yield');
    const tableIds = artifact.tables.map((table) => table.id);
    // The search-about source summary and the internal claim ledger are gone.
    expect(tableIds).not.toContain('table-source-yield');
    expect(tableIds).not.toContain('table-claim-ledger');
    // The characteristics-of-studies data table remains.
    expect(tableIds).toContain('table-study-characteristics');
  });

  it('cleans stale prompt leakage during export normalization', () => {
    const artifact = buildPublicationArtifact(manuscript, evidence);
    const normalized = normalizeManuscriptForPublication(
      {
        ...manuscript,
        abstract: {
          ...manuscript.abstract,
          methods: 'Retrieved records:\n[S1] raw prompt context\n\nThe app searched guarded biomedical sources [S1].',
        },
        sections: [
          {
            heading: 'Methods',
            body: [
              'Formatting rules:\nWrite only polished academic prose.',
              'The export should keep this source-grounded paragraph [S1].',
            ],
          },
          ...manuscript.sections,
        ],
      },
      artifact,
      { includeSupplementalSection: false },
    );
    const text = [
      normalized.abstract.methods,
      ...normalized.sections.flatMap((section) => [section.heading, ...section.body]),
    ].join(' ');

    expect(text).toContain('keep this source-grounded paragraph [1]');
    expect(text).not.toContain('raw prompt context');
    expect(text).not.toContain('Formatting rules');
  });

  it('flags internally inconsistent claim language for expert review', () => {
    const artifact = buildPublicationArtifact(
      {
        ...manuscript,
        sections: [
          {
            heading: 'Introduction',
            body: [
              'There is limited evidence for the interaction [S1]. However, the same section also claims strong evidence that the risk is proven [S1].',
            ],
          },
          ...manuscript.sections.slice(1),
        ],
      },
      evidence,
    );

    expect(artifact.validation.warnings.some((issue) => issue.code === 'claim-consistency-scarcity-strength')).toBe(true);
  });
});

describe('sanitizeSvgForHtml', () => {
  it('removes script tags from SVG', () => {
    const svg = '<svg><script>alert(1)</script><rect/></svg>';
    expect(sanitizeSvgForHtml(svg)).not.toContain('<script');
    expect(sanitizeSvgForHtml(svg)).toContain('<rect');
  });

  it('removes event handlers from SVG elements', () => {
    const svg = '<svg><rect onclick="alert(1)" onload="evil()"/></svg>';
    const cleaned = sanitizeSvgForHtml(svg);
    expect(cleaned).not.toContain('onclick');
    expect(cleaned).not.toContain('onload');
    expect(cleaned).toContain('<rect');
  });

  it('removes javascript: URIs', () => {
    const svg = '<svg><a href="javascript:alert(1)">x</a></svg>';
    expect(sanitizeSvgForHtml(svg)).not.toContain('javascript:');
  });

  it('preserves benign SVG content', () => {
    // DOMPurify may normalize self-closing tags (<rect/> → <rect></rect>),
    // so we check semantic content rather than byte-for-byte identity.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10" fill="red"/></svg>';
    const result = sanitizeSvgForHtml(svg);
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result).toContain('fill="red"');
    expect(result).not.toContain('<script');
  });
});
