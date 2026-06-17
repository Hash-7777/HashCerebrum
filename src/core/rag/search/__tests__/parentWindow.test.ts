import { describe, expect, it } from 'vitest';
import { parentWindowText } from '../parentWindow';
import type { RagChunk } from '../../types';

function doc(id: string, docId: string, index: number, text: string): RagChunk {
  return { id, projectId: 'p1', kind: 'document', title: 'Paper', text, source: 'library', createdAt: '2024-01-01', docId, chunkIndex: index };
}

describe('parentWindowText', () => {
  const chunks: RagChunk[] = [
    doc('a0', 'D1', 0, 'Intro passage.'),
    doc('a1', 'D1', 1, 'The key finding passage.'),
    doc('a2', 'D1', 2, 'Discussion passage.'),
    doc('b0', 'D2', 0, 'Other document.'),
  ];

  it('stitches a passage together with its same-document neighbours in order', () => {
    const out = parentWindowText(chunks[1]!, chunks, 1);
    expect(out).toBe('Intro passage. The key finding passage. Discussion passage.');
  });

  it('respects the radius', () => {
    const out = parentWindowText(chunks[1]!, chunks, 0);
    expect(out).toBe('The key finding passage.');
  });

  it('does not cross document boundaries', () => {
    const out = parentWindowText(chunks[3]!, chunks, 1);
    expect(out).toBe('Other document.');
  });

  it('returns text unchanged for a non-document chunk', () => {
    const finding: RagChunk = { id: 'f1', projectId: 'p1', kind: 'evidence', title: '', text: 'A finding.', source: 'pubmed', createdAt: '2024-01-01' };
    expect(parentWindowText(finding, chunks, 1)).toBe('A finding.');
  });

  it('de-duplicates identical neighbour passages', () => {
    const dupes: RagChunk[] = [
      doc('d0', 'D3', 0, 'Same text.'),
      doc('d1', 'D3', 1, 'Same text.'),
    ];
    expect(parentWindowText(dupes[0]!, dupes, 1)).toBe('Same text.');
  });
});
