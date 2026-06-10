import { describe, expect, it } from 'vitest';
import {
  ToolCallAccumulator,
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

  it('parses Anthropic tool_use start and delta chunks', () => {
    const start = parseAnthropicStreamLine(
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_abc","name":"pubmed_search","input":{}}}',
    );
    expect(start?.toolCallDeltas).toEqual([{ index: 0, id: 'toolu_abc', name: 'pubmed_search' }]);

    const delta = parseAnthropicStreamLine(
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"glioma\\"}"}}',
    );
    expect(delta?.toolCallDeltas).toEqual([{ index: 0, argsFragment: '{"q":"glioma"}' }]);
  });

  it('accumulates Anthropic tool_use fragments via ToolCallAccumulator', () => {
    const acc = new ToolCallAccumulator();
    acc.ingest(
      parseAnthropicStreamLine(
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_abc","name":"pubmed_search","input":{}}}',
      )?.toolCallDeltas,
    );
    acc.ingest(
      parseAnthropicStreamLine(
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"glio"}}',
      )?.toolCallDeltas,
    );
    acc.ingest(
      parseAnthropicStreamLine(
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ma\\"}"}}',
      )?.toolCallDeltas,
    );
    expect(acc.collect()).toEqual([{ id: 'toolu_abc', name: 'pubmed_search', args: { q: 'glioma' } }]);
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

describe('OpenAI tool-call fragmentation', () => {
  it('rebuilds a single tool call whose arguments span multiple SSE chunks', () => {
    const acc = new ToolCallAccumulator();
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"pubmed_search","arguments":"{\\"q"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"uery\\":\\"gli"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"oma\\",\\"max\\":5}"}}]}}]}',
    ];
    for (const line of chunks) acc.ingest(parseOpenAiStreamLine(line)?.toolCallDeltas);
    expect(acc.collect()).toEqual([
      { id: 'call_abc', name: 'pubmed_search', args: { query: 'glioma', max: 5 } },
    ]);
  });

  it('keeps parallel tool calls separated by index when their fragments interleave', () => {
    const acc = new ToolCallAccumulator();
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"pubmed_search","arguments":"{\\"q\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"openalex_query","arguments":"{\\"q\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"foo\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"\\"bar\\"}"}}]}}]}',
    ];
    for (const line of chunks) acc.ingest(parseOpenAiStreamLine(line)?.toolCallDeltas);
    expect(acc.collect()).toEqual([
      { id: 'a', name: 'pubmed_search', args: { q: 'foo' } },
      { id: 'b', name: 'openalex_query', args: { q: 'bar' } },
    ]);
  });

  it('falls back to empty args object when fragmented JSON never closes cleanly', () => {
    const acc = new ToolCallAccumulator();
    acc.ingest(
      parseOpenAiStreamLine(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"pubmed_search","arguments":"{\\"q\\":\\"glio"}}]}}]}',
      )?.toolCallDeltas,
    );
    const calls = acc.collect();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('pubmed_search');
    expect(calls[0]?.args).toEqual({});
  });

  it('ignores empty/whitespace-only argument fragments without losing earlier state', () => {
    const acc = new ToolCallAccumulator();
    acc.ingest(
      parseOpenAiStreamLine(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x","function":{"name":"pubmed_search","arguments":"{}"}}]}}]}',
      )?.toolCallDeltas,
    );
    acc.ingest(parseOpenAiStreamLine('data: {"choices":[{"delta":{"tool_calls":[]}}]}')?.toolCallDeltas);
    expect(acc.collect()).toEqual([{ id: 'x', name: 'pubmed_search', args: {} }]);
  });

  it('handles Ollama-style tool calls that arrive in a single NDJSON line', () => {
    const acc = new ToolCallAccumulator();
    acc.ingest(
      parseOllamaStreamLine(
        JSON.stringify({
          message: {
            content: '',
            tool_calls: [
              { index: 0, function: { name: 'pubmed_search', arguments: '{"query":"sepsis"}' } },
            ],
          },
        }),
      )?.toolCallDeltas,
    );
    expect(acc.collect()).toEqual([
      { id: 'call_0', name: 'pubmed_search', args: { query: 'sepsis' } },
    ]);
  });

  it('auto-assigns sequential indices when the provider omits the index field', () => {
    const acc = new ToolCallAccumulator();
    acc.ingest([
      { name: 'a', argsFragment: '{"x":1}' },
      { name: 'b', argsFragment: '{"y":2}' },
    ]);
    expect(acc.collect()).toEqual([
      { id: 'call_0', name: 'a', args: { x: 1 } },
      { id: 'call_1', name: 'b', args: { y: 2 } },
    ]);
  });
});
