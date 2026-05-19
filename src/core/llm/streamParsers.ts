import type { LlmToolCall } from './types';

export interface StreamParseResult {
  delta: string;
  toolCalls: LlmToolCall[];
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

export function parseOllamaStreamLine(line: string): StreamParseResult | null {
  try {
    const json = JSON.parse(line);
    return {
      delta: json.message?.content ?? '',
      toolCalls: normalizeOpenAiToolCalls(json.message?.tool_calls),
    };
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
    return {
      delta: delta?.content ?? '',
      toolCalls: normalizeOpenAiToolCalls(delta?.tool_calls),
    };
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
