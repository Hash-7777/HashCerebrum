import { describe, expect, it } from 'vitest';
import type { RagChunk, RagSearchHit } from '../../types';
import type { RerankProvider } from '../../rerank/workerClient';
import { crossEncoderRerank } from '../crossEncoderRerank';

function hit(id: string, text: string, score = 0.5): RagSearchHit {
  const chunk: RagChunk = {
    id,
    projectId: 'p1',
    kind: 'evidence',
    title: '',
    text,
    source: 'pubmed',
    createdAt: '2024-01-01',
  };
  return { chunk, score };
}

// A provider that scores passages by a caller-supplied map (text → score).
function providerFrom(scoreByText: Record<string, number>, ready = true): RerankProvider {
  return {
    ready,
    warmup: async () => {},
    rerank: async (_q, passages) => passages.map((p) => scoreByText[p] ?? 0),
  };
}

describe('crossEncoderRerank', () => {
  it('reorders the head by reranker score (highest first)', async () => {
    const hits = [hit('a', 'alpha'), hit('b', 'beta'), hit('c', 'gamma')];
    // Reranker prefers the reverse order.
    const provider = providerFrom({ alpha: 0.1, beta: 0.5, gamma: 0.9 });
    const out = await crossEncoderRerank('q', hits, { provider });
    expect(out.map((h) => h.chunk.id)).toEqual(['c', 'b', 'a']);
  });

  it('only rescores the top-N and preserves the tail order', async () => {
    const hits = [hit('a', 'alpha'), hit('b', 'beta'), hit('c', 'gamma'), hit('d', 'delta')];
    const provider = providerFrom({ alpha: 0.1, beta: 0.9 });
    const out = await crossEncoderRerank('q', hits, { provider, topN: 2 });
    // Head [a,b] reordered to [b,a]; tail [c,d] untouched.
    expect(out.map((h) => h.chunk.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('returns the input order unchanged when the provider is not ready (empty scores)', async () => {
    const hits = [hit('a', 'alpha'), hit('b', 'beta')];
    const notReady: RerankProvider = { ready: false, warmup: async () => {}, rerank: async () => [] };
    const out = await crossEncoderRerank('q', hits, { provider: notReady });
    expect(out.map((h) => h.chunk.id)).toEqual(['a', 'b']);
  });

  it('returns the input order unchanged when the provider throws', async () => {
    const hits = [hit('a', 'alpha'), hit('b', 'beta')];
    const throwing: RerankProvider = {
      ready: true,
      warmup: async () => {},
      rerank: async () => {
        throw new Error('worker crashed');
      },
    };
    const out = await crossEncoderRerank('q', hits, { provider: throwing });
    expect(out.map((h) => h.chunk.id)).toEqual(['a', 'b']);
  });

  it('is a no-op for fewer than two hits or an empty query', async () => {
    const provider = providerFrom({ alpha: 0.9 });
    expect(await crossEncoderRerank('q', [hit('a', 'alpha')], { provider })).toHaveLength(1);
    expect((await crossEncoderRerank('  ', [hit('a', 'alpha'), hit('b', 'beta')], { provider })).map((h) => h.chunk.id)).toEqual(['a', 'b']);
  });
});
