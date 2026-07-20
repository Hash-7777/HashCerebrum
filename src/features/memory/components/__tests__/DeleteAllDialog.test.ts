import { describe, it, expect } from 'vitest';
import { describeDeletion } from '../DeleteAllDialog';
import type { RagChunk } from '@core/rag';

const chunk = (over: Partial<RagChunk>): RagChunk => ({
  id: Math.random().toString(36).slice(2),
  projectId: 'p1',
  kind: 'evidence',
  title: 'A finding',
  text: 'text',
  source: 'pubmed',
  createdAt: '2026-01-01',
  ...over,
});

describe('describeDeletion', () => {
  it('counts each kind separately and totals every chunk', () => {
    const summary = describeDeletion(
      [
        chunk({ kind: 'evidence' }),
        chunk({ kind: 'evidence' }),
        chunk({ kind: 'answer' }),
        chunk({ kind: 'document' }),
      ],
      1,
    );
    expect(summary.total).toBe(4);
    expect(summary.rows.map((r) => [r.count, r.label])).toEqual([
      [2, 'source records'],
      [1, 'saved answer'],
      [1, 'passage'],
    ]);
  });

  // A confirmation that lists "0 saved answers" invites the user to wonder what
  // else it is wrong about, so an absent kind is omitted rather than shown.
  it('omits a kind with nothing to delete', () => {
    const summary = describeDeletion([chunk({ kind: 'evidence' })], 0);
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]?.label).toBe('source record');
  });

  it('names the number of imported papers the passages came from', () => {
    const summary = describeDeletion([chunk({ kind: 'document' })], 3);
    expect(summary.rows[0]?.detail).toBe('from 3 imported papers');
    expect(describeDeletion([chunk({ kind: 'document' })], 1).rows[0]?.detail).toBe(
      'from 1 imported paper',
    );
  });

  it('reports the real span the findings were saved over', () => {
    const summary = describeDeletion(
      [
        chunk({ createdAt: '2026-03-04' }),
        chunk({ createdAt: '2026-01-09' }),
        chunk({ createdAt: '2026-07-20' }),
      ],
      0,
    );
    expect(summary.oldest).toBe('2026-01-09');
    expect(summary.newest).toBe('2026-07-20');
  });

  it('returns an empty summary for an empty project', () => {
    const summary = describeDeletion([], 0);
    expect(summary.total).toBe(0);
    expect(summary.rows).toEqual([]);
  });
});
