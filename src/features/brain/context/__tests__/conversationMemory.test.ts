import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAllConversationMemory,
  forgetChat,
  recallTurns,
  rememberTurns,
  type TurnEmbedder,
} from '../conversationMemory';

// A deterministic fake embedder: each distinct word maps to a one-hot axis, so a
// query embeds close to turns sharing its words. Vectors are normalised so cosine
// behaves like the real (normalised) provider.
const VOCAB = ['mthfr', 'c677t', 'factor', 'v', 'leiden', 'warfarin', 'dose', 'thrombosis', 'aspirin'];
function embedText(text: string): Float32Array {
  const v = new Float32Array(VOCAB.length);
  for (const w of text.toLowerCase().split(/\W+/)) {
    const i = VOCAB.indexOf(w);
    if (i >= 0) v[i] = (v[i] ?? 0) + 1;
  }
  const mag = Math.hypot(...v) || 1;
  for (let i = 0; i < v.length; i += 1) v[i] = (v[i] ?? 0) / mag;
  return v;
}
const fakeEmbedder: TurnEmbedder = {
  ready: true,
  embed: (texts) => Promise.resolve(texts.map(embedText)),
};

afterEach(() => clearAllConversationMemory());

describe('conversationMemory (isolated semantic recall)', () => {
  it('recalls the most relevant earlier turn for a query', async () => {
    await rememberTurns(
      'chat-1',
      [
        { id: 't1', role: 'user', content: 'does the MTHFR C677T variant raise thrombosis risk' },
        { id: 't2', role: 'assistant', content: 'yes, C677T MTHFR shows a modest thrombosis association' },
        { id: 't3', role: 'user', content: 'what warfarin dose should be used' },
      ],
      fakeEmbedder,
    );
    const hits = await recallTurns('chat-1', 'tell me again about MTHFR thrombosis', fakeEmbedder, {
      k: 2,
    });
    const joined = hits.map((h) => h.content).join(' ');
    expect(joined).toMatch(/MTHFR/);
    expect(joined).not.toMatch(/warfarin dose/); // the off-topic turn is not recalled
  });

  it('never crosses chats — recall is scoped to the given chat id', async () => {
    await rememberTurns('chat-A', [{ id: 'a1', role: 'user', content: 'warfarin dose question' }], fakeEmbedder);
    await rememberTurns('chat-B', [{ id: 'b1', role: 'user', content: 'aspirin question' }], fakeEmbedder);
    const inB = await recallTurns('chat-B', 'warfarin dose', fakeEmbedder, { minScore: 0 });
    expect(inB.every((m) => !m.content.includes('warfarin'))).toBe(true);
  });

  it('excludes turns already shown in the recent window', async () => {
    await rememberTurns(
      'chat-2',
      [
        { id: 'x1', role: 'user', content: 'MTHFR thrombosis' },
        { id: 'x2', role: 'assistant', content: 'MTHFR thrombosis answer' },
      ],
      fakeEmbedder,
    );
    const hits = await recallTurns('chat-2', 'MTHFR thrombosis', fakeEmbedder, {
      excludeIds: new Set(['x2']),
      minScore: 0,
    });
    expect(hits.every((h) => h.content !== 'MTHFR thrombosis answer')).toBe(true);
  });

  it('returns nothing when the embedder is not ready (lexical fallback handled elsewhere)', async () => {
    const cold: TurnEmbedder = { ready: false, embed: () => Promise.resolve([]) };
    await rememberTurns('chat-3', [{ id: 'c1', role: 'user', content: 'MTHFR' }], cold);
    expect(await recallTurns('chat-3', 'MTHFR', cold)).toEqual([]);
  });

  it('forgetChat drops a chat’s memory', async () => {
    await rememberTurns('chat-4', [{ id: 'd1', role: 'user', content: 'MTHFR thrombosis' }], fakeEmbedder);
    forgetChat('chat-4');
    expect(await recallTurns('chat-4', 'MTHFR', fakeEmbedder, { minScore: 0 })).toEqual([]);
  });
});
