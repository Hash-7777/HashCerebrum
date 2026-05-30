import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import {
  buildSourceGroundedPaperFallback,
  detectPaperRequest,
  fallbackPaperTasks,
  isPriorWorkReviewRequest,
  manuscriptStandardForQuestion,
} from '../paper';

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

  it('maps journal style requests onto export templates', () => {
    expect(manuscriptStandardForQuestion('write this as an AMA manuscript')).toBe('ama');
    expect(manuscriptStandardForQuestion('draft for NEJM style')).toBe('nejm_style');
    expect(manuscriptStandardForQuestion('make it Lancet ready')).toBe('lancet_style');
    expect(manuscriptStandardForQuestion('Nature Medicine style paper')).toBe('nature_medicine_style');
    expect(manuscriptStandardForQuestion('standard manuscript')).toBe('icmje_generic');
  });

  it('builds broad fallback tasks for manuscript drafting', () => {
    const tasks = fallbackPaperTasks('make a full research paper about NSAIDs and warfarin');

    expect(tasks.map((task) => task.agentId)).toEqual([
      'literature',
      'trials',
      'data_scientist',
      'pharmacology',
      'drug_interactions',
    ]);
  });

  it('recognises a follow-up that appraises prior work, not a fresh research request', () => {
    // Appraisal verb + back-reference to the prior output.
    expect(isPriorWorkReviewRequest('rate that paper')).toBe(true);
    expect(isPriorWorkReviewRequest('review this draft')).toBe(true);
    expect(isPriorWorkReviewRequest('how would you grade it?')).toBe(true);
    expect(isPriorWorkReviewRequest('critique the manuscript above')).toBe(true);
    // Fresh research / writing requests must NOT be captured (no back-reference).
    expect(isPriorWorkReviewRequest('write a systematic review of statins')).toBe(false);
    expect(isPriorWorkReviewRequest('review the evidence on GLP-1 agonists')).toBe(false);
    expect(isPriorWorkReviewRequest('make a paper about sepsis')).toBe(false);
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
    expect(fallback).toContain('[1] PUBMED');
    expect(fallback).toContain('boss unavailable');
  });
});
