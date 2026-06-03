import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { buildContinuePrompt, buildSourceBlock, markersWithinRange } from '../continueWriting';

function rec(title: string, snippet: string): EvidenceItem {
  return {
    source: 'pubmed',
    title,
    authors: [],
    identifiers: {},
    snippet,
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: 'h',
  };
}

describe('buildSourceBlock', () => {
  it('numbers sources from 1 and reports the count', () => {
    const block = buildSourceBlock([rec('A', 'alpha'), rec('B', 'beta')]);
    expect(block.count).toBe(2);
    expect(block.text).toContain('[1] A: alpha');
    expect(block.text).toContain('[2] B: beta');
  });

  it('caps at twelve sources', () => {
    const many = Array.from({ length: 20 }, (_, i) => rec(`T${i}`, `s${i}`));
    expect(buildSourceBlock(many).count).toBe(12);
  });
});

describe('markersWithinRange', () => {
  it('accepts markers within the source count', () => {
    expect(markersWithinRange('Risk rises [1] and falls [2].', 2)).toBe(true);
  });
  it('rejects a marker beyond the source count', () => {
    expect(markersWithinRange('Risk rises [3].', 2)).toBe(false);
  });
  it('accepts text with no markers', () => {
    expect(markersWithinRange('No citation here.', 2)).toBe(true);
  });
});

describe('buildContinuePrompt', () => {
  it('includes the sources and the trailing manuscript text', () => {
    const prompt = buildContinuePrompt('…prior sentence.', buildSourceBlock([rec('A', 'alpha')]));
    expect(prompt).toContain('[1] A: alpha');
    expect(prompt).toContain('prior sentence.');
  });
});
