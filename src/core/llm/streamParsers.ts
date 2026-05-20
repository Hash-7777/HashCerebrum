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
}

export function parseToolArgs(args: unknown): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === 'string') {
    try {
      return JSON.parse(args) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return args as Record<string, unknown>;
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
    return withDeltas(
      {
        delta: json.message?.content ?? '',
        toolCalls: normalizeOpenAiToolCalls(json.message?.tool_calls),
      },
      json.message?.tool_calls,
    );
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
    const delta = json.choices?.[0]?.delta;
    return withDeltas(
      { delta: delta?.content ?? '', toolCalls: normalizeOpenAiToolCalls(delta?.tool_calls) },
      delta?.tool_calls,
    );
  } catch {
    return null;
  }
}

export function parseAnthropicStreamLine(line: string): StreamParseResult | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const json = JSON.parse(payload);
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
    const p = part as { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } };
    if (p.text) delta += p.text;
    if (p.functionCall?.name) {
      toolCalls.push({
        id: `call_gemini_${index}_${p.functionCall.name}`,
        name: p.functionCall.name,
        args: p.functionCall.args ?? {},
      });
    }
  });

  return { delta, toolCalls };
}

export function parseGeminiResponse(data: unknown): StreamParseResult {
  const json = data as { candidates?: Array<{ content?: { parts?: unknown[] } }> };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parseGeminiParts(parts);
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
