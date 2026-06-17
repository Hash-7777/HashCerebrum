import { describe, expect, it } from 'vitest';
import { applyQueryInstruction, EMBED_MODEL, EMBED_MODEL_FALLBACK } from '../model.config';

describe('applyQueryInstruction', () => {
  it('embeds the query verbatim when the model defines no instruction (MedEmbed)', () => {
    expect(EMBED_MODEL.queryInstruction).toBeUndefined();
    expect(applyQueryInstruction('aspirin in MI', EMBED_MODEL)).toBe('aspirin in MI');
  });

  it('prefixes the bge fallback query with its trained instruction', () => {
    expect(EMBED_MODEL_FALLBACK.queryInstruction).toBeTruthy();
    const out = applyQueryInstruction('aspirin in MI', EMBED_MODEL_FALLBACK);
    expect(out).toBe(`${EMBED_MODEL_FALLBACK.queryInstruction}aspirin in MI`);
    expect(out.endsWith('aspirin in MI')).toBe(true);
  });

  it('passes text through for an empty instruction', () => {
    expect(applyQueryInstruction('x', { id: 'm', dimension: 384, maxTokens: 512, queryInstruction: '' })).toBe('x');
  });
});
