import { describe, expect, it } from 'vitest';
import { mergeEvidence } from '../evidenceRanking';
import type { EvidenceItem } from '@platform/index';
import type { SpecialistResult } from '../types';

const rec = (over: Partial<EvidenceItem>): EvidenceItem =>
  ({
    source: 'pubmed',
    title: 'An invented randomised trial of a study drug in heart failure',
    authors: ['Doe J'],
    year: 2022,
    identifiers: {},
    fetchedAt: '2026-01-01T00:00:00Z',
    provenanceHash: Math.random().toString(36),
    ...over,
  }) as EvidenceItem;

const team = (...evidence: EvidenceItem[][]): SpecialistResult[] =>
  evidence.map((ev, i) => ({ agentId: 'evidence_synthesis', label: `s${i}`, subQuery: 'q', findings: '', evidence: ev, toolCalls: 1 }));

describe('mergeEvidence', () => {
  it('counts a paper once when two databases return it at different addresses', () => {
    const fromPubmed = rec({ source: 'pubmed', url: 'https://pubmed.ncbi.nlm.nih.gov/123/', identifiers: { pmid: '123' } });
    const fromMirror = rec({ source: 'europepmc', url: 'https://europepmc.org/article/MED/123', identifiers: { pmid: '123' } });
    const merged = mergeEvidence(team([fromMirror], [fromPubmed]));
    expect(merged).toHaveLength(1);
    // The primary index is kept over the mirror, whichever specialist found it first.
    expect(merged[0]!.source).toBe('pubmed');
  });

  it('counts a paper once when only its title and year match', () => {
    const a = rec({ source: 'openalex', url: 'https://openalex.org/W1', identifiers: { doi: '10.1/abc' } });
    const b = rec({ source: 'semantic_scholar', url: 'https://example.org/paper/1', identifiers: {} });
    expect(mergeEvidence(team([a], [b]))).toHaveLength(1);
  });

  it('keeps different papers apart', () => {
    const a = rec({ identifiers: { pmid: '1' }, title: 'First invented trial of a study drug in adults' });
    const b = rec({ identifiers: { pmid: '2' }, title: 'Second invented cohort of a study drug in adults' });
    expect(mergeEvidence(team([a, b]))).toHaveLength(2);
  });

  it('does not merge two records that share only a short generic title', () => {
    const a = rec({ identifiers: { pmid: '7' }, title: 'Editorial' });
    const b = rec({ identifiers: { pmid: '8' }, title: 'Editorial' });
    expect(mergeEvidence(team([a, b]))).toHaveLength(2);
  });
});
