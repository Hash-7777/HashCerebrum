import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { buildSourceGroundedPaperFallback, detectPaperRequest, fallbackPaperTasks } from '../paper';

const evidence: EvidenceItem[] = [
  {
    source: 'pubmed',
    title: 'Warfarin and NSAID bleeding risk review',
    year: 2026,
    authors: ['HashCerebrum test'],
    identifiers: { pmid: '123' },
    snippet: 'Synthetic source summary for a source-grounded manuscript test.',
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: 'paper-test-1',
  },
];

describe('paper request helpers', () => {
  it('detects full manuscript requests and chooses an IMRaD default', () => {
    const request = detectPaperRequest('make a full research paper about NSAIDs and warfarin');

    expect(request?.standard).toBe('imrad_review');
    expect(request?.label).toContain('IMRaD');
  });

  it('detects review reporting forms when the user asks for them', () => {
    const request = detectPaperRequest('draft a systematic review manuscript using PRISMA');

    expect(request?.standard).toBe('prisma_review');
  });

  it('builds broad fallback tasks for manuscript drafting', () => {
    const tasks = fallbackPaperTasks('make a full research paper about NSAIDs and warfarin');

    expect(tasks.map((task) => task.agentId)).toEqual([
      'literature',
      'pharmacology',
      'trials',
      'public_health',
    ]);
  });

  it('keeps synthesis-failure fallbacks structured like a paper', () => {
    const request = detectPaperRequest('make a full research paper about NSAIDs and warfarin');
    expect(request).not.toBeNull();

    const fallback = buildSourceGroundedPaperFallback(
      'NSAIDs and warfarin',
      request!,
      evidence,
      [
        {
          agentId: 'pharmacology',
          label: 'Pharmacology',
          subQuery: 'mechanism',
          findings: 'retrieved mechanism evidence',
          evidence,
          toolCalls: 1,
        },
      ],
      'boss unavailable',
    );

    expect(fallback).toContain('# Manuscript Draft');
    expect(fallback).toContain('## Structured Abstract');
    expect(fallback).toContain('## Methods');
    expect(fallback).toContain('## References');
    expect(fallback).toContain('[S1] PUBMED');
    expect(fallback).toContain('boss unavailable');
  });
});
