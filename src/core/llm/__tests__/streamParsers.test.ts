import { describe, expect, it } from 'vitest';
import {
  parseAnthropicStreamLine,
  parseGeminiStreamLine,
  parseOllamaStreamLine,
  parseOpenAiStreamLine,
} from '../streamParsers';

describe('LLM stream parsers', () => {
  it('parses Ollama NDJSON token chunks', () => {
    const parsed = parseOllamaStreamLine(JSON.stringify({ message: { content: 'hello' } }));
    expect(parsed).toEqual({ delta: 'hello', toolCalls: [] });
  });

  it('ignores malformed Ollama chunks', () => {
    expect(parseOllamaStreamLine('{')).toBeNull();
  });

  it('parses OpenAI-compatible SSE deltas', () => {
    const parsed = parseOpenAiStreamLine('data: {"choices":[{"delta":{"content":"world"}}]}');
    expect(parsed).toEqual({ delta: 'world', toolCalls: [] });
  });

  it('ignores OpenAI-compatible done markers and event lines', () => {
    expect(parseOpenAiStreamLine('data: [DONE]')).toBeNull();
    expect(parseOpenAiStreamLine('event: completion')).toBeNull();
  });

  it('parses Anthropic text_delta SSE chunks', () => {
    const parsed = parseAnthropicStreamLine(
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"chunk"}}',
    );
    expect(parsed).toEqual({ delta: 'chunk', toolCalls: [] });
  });

  it('parses Gemini streamGenerateContent SSE chunks', () => {
    const parsed = parseGeminiStreamLine(
      'data: {"candidates":[{"content":{"parts":[{"text":"The image displays"}],"role":"model"},"index":0}]}',
    );
    expect(parsed).toEqual({ delta: 'The image displays', toolCalls: [] });
  });

  it('parses Gemini function call parts', () => {
    const parsed = parseGeminiStreamLine(
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"pubmed_search","args":{"query":"glioma"}}}]}}]}',
    );
    expect(parsed?.delta).toBe('');
    expect(parsed?.toolCalls).toEqual([
      {
        id: 'call_gemini_0_pubmed_search',
        name: 'pubmed_search',
        args: { query: 'glioma' },
      },
    ]);
  });
});
