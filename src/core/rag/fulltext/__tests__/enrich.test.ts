import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import type { EmbeddingProvider } from '../../types';
import { enrichEvidenceWithFullText, splitPassages, openAccessRef } from '../enrich';

function ev(id: string, identifiers: Record<string, string>, snippet = 'abstract text'): EvidenceItem {
  return {
    source: 'europepmc',
    title: `Paper ${id}`,
    authors: [],
    identifiers,
    snippet,
    fetchedAt: '2024-01-01',
    provenanceHash: 'h',
  };
}

// Deterministic embedder: text mentioning "renal" points the same way as the
// query, everything else is orthogonal — so the renal passage always wins.
const embedder: EmbeddingProvider = {
  ready: true,
  warmup: async () => {},
  embed: async (texts) => texts.map((t) => Float32Array.from(/renal/i.test(t) ? [1, 0] : [0, 1])),
};

const RENAL = `This randomised study reports the renal outcomes in detail, describing the change in creatinine and eGFR across the treatment and control arms over twelve months of careful follow-up in the cohort.`;
const OTHER = `The introduction reviews the general background and history of the condition without reporting any specific numerical outcome, spanning several sentences of context that carry no result for the question at hand here today.`;

describe('splitPassages', () => {
  it('splits on blank lines and drops tiny fragments', () => {
    const out = splitPassages(`${RENAL}\n\n${OTHER}\n\ntoo short`);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('renal outcomes');
  });
});

describe('openAccessRef', () => {
  it('returns a PMC ref only for a valid pmcid', () => {
    expect(openAccessRef(ev('a', { pmcid: 'PMC123' }))).toEqual({ source: 'PMC', id: 'PMC123' });
    expect(openAccessRef(ev('b', { pmid: '999' }))).toBeNull();
  });
});

describe('enrichEvidenceWithFullText', () => {
  it('replaces the abstract with the most relevant full-text passage', async () => {
    const evidence = [ev('a', { pmcid: 'PMC1' })];
    const fetch = async () => `${OTHER}\n\n${RENAL}`;
    const out = await enrichEvidenceWithFullText('renal effect', evidence, { fetch, embedder });
    expect(out[0]!.snippet).toContain('renal outcomes');
    expect(out[0]!.identifiers.fulltext).toBe('europepmc');
  });

  it('leaves non-open-access records untouched', async () => {
    const evidence = [ev('a', { pmid: '999' }, 'keep me')];
    const out = await enrichEvidenceWithFullText('renal effect', evidence, {
      fetch: async () => RENAL,
      embedder,
    });
    expect(out[0]!.snippet).toBe('keep me');
    expect(out[0]!.identifiers.fulltext).toBeUndefined();
  });

  it('keeps the abstract when no full text is available', async () => {
    const evidence = [ev('a', { pmcid: 'PMC1' }, 'keep me')];
    const out = await enrichEvidenceWithFullText('renal effect', evidence, {
      fetch: async () => null,
      embedder,
    });
    expect(out[0]!.snippet).toBe('keep me');
  });

  it('is a no-op when the embedder is not ready', async () => {
    const notReady: EmbeddingProvider = { ready: false, warmup: async () => {}, embed: async () => [] };
    const evidence = [ev('a', { pmcid: 'PMC1' }, 'keep me')];
    const out = await enrichEvidenceWithFullText('renal effect', evidence, {
      fetch: async () => RENAL,
      embedder: notReady,
    });
    expect(out[0]!.snippet).toBe('keep me');
  });

  it('respects the record limit', async () => {
    const evidence = [ev('a', { pmcid: 'PMC1' }), ev('b', { pmcid: 'PMC2' })];
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return RENAL;
    };
    await enrichEvidenceWithFullText('renal effect', evidence, { fetch, embedder, limit: 1 });
    expect(calls).toBe(1);
  });
});
