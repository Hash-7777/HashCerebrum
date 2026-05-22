import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import type { Manuscript } from '../manuscript';
import {
  assertPublicationReady,
  buildPublicationArtifact,
  normalizeManuscriptForPublication,
  publicationMarkdown,
  referenceLinesForPublication,
  sanitizeSvgForHtml,
} from '../publication';

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

  it('blocks publication export when required section depth is not met', () => {
    const artifact = buildPublicationArtifact(manuscript, evidence);

    expect(artifact.validation.exportReady).toBe(false);
    expect(artifact.validation.blockers.some((issue) => issue.code === 'section-too-short')).toBe(true);
    expect(() => assertPublicationReady(artifact)).toThrow(/publication validation/i);
  });

  it('exports a markdown package with canonical references and SVG figure assets', () => {
    const artifact = buildPublicationArtifact(manuscript, evidence);
    const markdown = publicationMarkdown(manuscript, artifact);

    expect(markdown).toContain('## Figure SVG Assets');
    expect(markdown).toContain('<svg');
    expect(markdown).toContain('## References');
    expect(markdown).toContain('[1] A Researcher, B Clinician');
    expect(markdown).not.toContain('[S2]');
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
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10" fill="red"/></svg>';
    expect(sanitizeSvgForHtml(svg)).toBe(svg);
  });
});
