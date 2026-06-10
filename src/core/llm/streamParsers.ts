import type { LlmToolCall } from './types';

export interface OpenAiToolCallDelta {
  index?: number;
  id?: string;
  name?: string;
  argsFragment?: string;
}

export interface StreamParseResult {
  delta: string;
  toolCalls: LlmToolCall[];
  toolCallDeltas?: OpenAiToolCallDelta[];
  // Why generation stopped, when the provider reports it on a chunk:
  // OpenAI 'length'/'stop', Anthropic 'max_tokens'/'end_turn', Gemini
  // 'MAX_TOKENS'/'STOP', Ollama done_reason 'length'/'stop'.
  finishReason?: string;
}

export function parseToolArgs(args: unknown): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }
  if (typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

export function normalizeOpenAiToolCalls(calls: unknown[] | undefined): LlmToolCall[] {
  if (!Array.isArray(calls)) return [];
  return calls
    .map((call, index) => {
      const c = call as {
        id?: string;
        name?: string;
        function?: { name?: string; arguments?: unknown };
        arguments?: unknown;
      };
      return {
        id: c.id || `call_${index}`,
        name: c.function?.name || c.name,
        args: parseToolArgs(c.function?.arguments ?? c.arguments),
      };
    })
    .filter((call): call is LlmToolCall => !!call.name);
}

export function extractOpenAiToolCallDeltas(calls: unknown[] | undefined): OpenAiToolCallDelta[] {
  if (!Array.isArray(calls)) return [];
  return calls.map((c) => {
    const call = c as {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    const out: OpenAiToolCallDelta = {};
    if (typeof call.index === 'number') out.index = call.index;
    if (call.id) out.id = call.id;
    if (call.function?.name) out.name = call.function.name;
    if (typeof call.function?.arguments === 'string') out.argsFragment = call.function.arguments;
    return out;
  });
}

// Merges fragmented OpenAI-compatible tool-call SSE deltas. Per the spec,
// `arguments` is streamed character-by-character across chunks, keyed by
// `index`. Without accumulation each fragment would surface as its own
// LlmToolCall with empty args.
export class ToolCallAccumulator {
  private byIndex = new Map<number, { id?: string; name?: string; argsBuffer: string }>();
  private autoIndex = 0;

  ingest(deltas: OpenAiToolCallDelta[] | undefined): void {
    if (!deltas || deltas.length === 0) return;
    for (const d of deltas) {
      const index = typeof d.index === 'number' ? d.index : this.autoIndex++;
      const slot = this.byIndex.get(index) ?? { argsBuffer: '' };
      if (d.id) slot.id = d.id;
      if (d.name) slot.name = d.name;
      if (typeof d.argsFragment === 'string') slot.argsBuffer += d.argsFragment;
      this.byIndex.set(index, slot);
    }
  }

  collect(): LlmToolCall[] {
    const out: LlmToolCall[] = [];
    const sorted = [...this.byIndex.entries()].sort(([a], [b]) => a - b);
    for (const [index, slot] of sorted) {
      if (!slot.name) continue;
      out.push({
        id: slot.id || `call_${index}`,
        name: slot.name,
        args: parseToolArgs(slot.argsBuffer || '{}'),
      });
    }
    return out;
  }
}

function withDeltas(base: { delta: string; toolCalls: LlmToolCall[] }, raw: unknown[] | undefined): StreamParseResult {
  const deltas = extractOpenAiToolCallDeltas(raw);
  return deltas.length > 0 ? { ...base, toolCallDeltas: deltas } : base;
}

export function parseOllamaStreamLine(line: string): StreamParseResult | null {
  try {
    const json = JSON.parse(line);
    const result = withDeltas(
      {
        delta: json.message?.content ?? '',
        toolCalls: normalizeOpenAiToolCalls(json.message?.tool_calls),
      },
      json.message?.tool_calls,
    );
    if (typeof json.done_reason === 'string') result.finishReason = json.done_reason;
    return result;
  } catch {
    return null;
  }
}

export function parseOpenAiStreamLine(line: string): StreamParseResult | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const json = JSON.parse(payload);
    const choice = json.choices?.[0];
    const result = withDeltas(
      { delta: choice?.delta?.content ?? '', toolCalls: normalizeOpenAiToolCalls(choice?.delta?.tool_calls) },
      choice?.delta?.tool_calls,
    );
    if (typeof choice?.finish_reason === 'string') result.finishReason = choice.finish_reason;
    return result;
  } catch {
    return null;
  }
}

function extractAnthropicToolCallDeltas(json: Record<string, unknown>): OpenAiToolCallDelta[] {
  if (json.type === 'content_block_start' && json.content_block && typeof json.content_block === 'object') {
    const block = json.content_block as Record<string, unknown>;
    if (block.type === 'tool_use') {
      const out: OpenAiToolCallDelta = {};
      if (typeof json.index === 'number') out.index = json.index;
      if (typeof block.id === 'string') out.id = block.id;
      if (typeof block.name === 'string') out.name = block.name;
      return [out];
    }
  }
  if (json.type === 'content_block_delta' && json.delta && typeof json.delta === 'object') {
    const delta = json.delta as Record<string, unknown>;
    if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const out: OpenAiToolCallDelta = {};
      if (typeof json.index === 'number') out.index = json.index;
      out.argsFragment = delta.partial_json;
      return [out];
    }
  }
  return [];
}

export function parseAnthropicStreamLine(line: string): StreamParseResult | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const json = JSON.parse(payload);
    // message_delta carries the stop_reason (e.g. 'max_tokens') at the end.
    if (json.type === 'message_delta' && typeof json.delta?.stop_reason === 'string') {
      return { delta: '', toolCalls: [], finishReason: json.delta.stop_reason };
    }
    const toolDeltas = extractAnthropicToolCallDeltas(json);
    if (toolDeltas.length > 0) {
      return { delta: '', toolCalls: [], toolCallDeltas: toolDeltas };
    }
    if (json.type !== 'content_block_delta' || json.delta?.type !== 'text_delta') return null;
    return { delta: json.delta.text ?? '', toolCalls: [] };
  } catch {
    return null;
  }
}

function parseGeminiParts(parts: unknown[]): StreamParseResult {
  const toolCalls: LlmToolCall[] = [];
  let delta = '';

  parts.forEach((part, index) => {
    if (!part || typeof part !== 'object') return;
    const p = part as Record<string, unknown>;
    const text = typeof p.text === 'string' ? p.text : '';
    if (text) delta += text;
    const functionCall =
      p.functionCall && typeof p.functionCall === 'object' && !Array.isArray(p.functionCall)
        ? (p.functionCall as Record<string, unknown>)
        : null;
    const name = functionCall && typeof functionCall.name === 'string' ? functionCall.name : '';
    if (name && functionCall) {
      toolCalls.push({
        id: `call_gemini_${index}_${name}`,
        name,
        args: parseToolArgs(functionCall.args),
      });
    }
  });

  return { delta, toolCalls };
}

export function parseGeminiResponse(data: unknown): StreamParseResult {
  const json = data as { candidates?: Array<{ content?: { parts?: unknown[] }; finishReason?: string }> };
  const candidate = json.candidates?.[0];
  const result = parseGeminiParts(candidate?.content?.parts ?? []);
  if (typeof candidate?.finishReason === 'string') result.finishReason = candidate.finishReason;
  return result;
}

export function parseGeminiStreamLine(line: string): StreamParseResult | null {
  const payload = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    return parseGeminiResponse(JSON.parse(payload));
  } catch {
    return null;
  }
}
