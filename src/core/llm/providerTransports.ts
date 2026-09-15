// One request per provider API, blocking and streaming: OpenAI-compatible chat
// completions, Ollama's /api/chat, Anthropic Messages and Gemini
// generateContent. The model-chain, failover and continuation logic that picks
// which of these to call lives in ProviderRegistry.ts.
//
// Every call goes through the platform adapter to the Rust proxy, so it passes
// the same guard, rate limiter and audit as any other outbound request. A key
// is read from the secrets store at call time, and secret values are redacted
// from any error text. Token usage split across stream chunks is folded into
// the final response.

import { platform } from '@platform/index';
import { providerKeyName } from './modelCatalog';
import { OPENAI_COMPAT_CHAT_URL } from './providerEndpoints';
import { getOllamaHost } from './providerSettings';
import { redactSecrets, secretValuesFromHeaders } from './secrets';
import {
  ToolCallAccumulator,
  normalizeOpenAiToolCalls,
  parseAnthropicStreamLine,
  parseGeminiResponse,
  parseGeminiStreamLine,
  parseOllamaStreamLine,
  parseOpenAiStreamLine,
} from './streamParsers';
import type { LlmProviderId, LlmRequest, LlmResponse, LlmToolCall, LlmToolSpec } from './types';

// Token usage arrives across several stream chunks (and Anthropic splits input
// vs output between events), so callers accumulate it and these helpers fold
// partials in and build the final, fully-populated usage for the response.
function mergeUsage(
  into: { inputTokens?: number; outputTokens?: number },
  from?: { inputTokens?: number; outputTokens?: number },
): void {
  if (!from) return;
  if (typeof from.inputTokens === 'number') into.inputTokens = from.inputTokens;
  if (typeof from.outputTokens === 'number') into.outputTokens = from.outputTokens;
}

function usageResponse(
  acc: { inputTokens?: number; outputTokens?: number },
): { usage: { inputTokens: number; outputTokens: number } } | Record<string, never> {
  if (acc.inputTokens === undefined && acc.outputTokens === undefined) return {};
  return { usage: { inputTokens: acc.inputTokens ?? 0, outputTokens: acc.outputTokens ?? 0 } };
}

interface ProviderResponse<T = unknown> {
  choices?: Array<{ message?: { content?: string; tool_calls?: T[] } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function asOpenAiTools(tools: LlmToolSpec[] = []) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

async function requireKey(providerId: LlmProviderId): Promise<string> {
  const keyName = providerKeyName(providerId);
  if (!keyName) return '';
  const key = await platform().secrets.retrieve(keyName);
  if (!key) throw new Error(`${providerId} API key is missing. Add it in Settings.`);
  return key;
}

function toTextMessages(req: LlmRequest) {
  return req.messages.map((message) => ({
    role: message.role === 'tool' ? 'tool' : message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolName ? { name: message.toolName } : {}),
  }));
}

// Non-streaming chat POST through the Rust proxy (guard + rate-limit +
// audit). Returns the parsed JSON body; throws on a non-2xx status.
async function postJson<T = unknown>(
  provider: LlmProviderId,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<T> {
  const { status, body: text } = await platform().llm.httpPost(provider, url, headers, JSON.stringify(body));
  if (status < 200 || status >= 300) {
    throw new Error(`${provider} HTTP ${status}: ${redactSecrets(text.slice(0, 240), secretValuesFromHeaders(headers))}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${provider} returned a non-JSON response`);
  }
}

async function chatStream(
  provider: LlmProviderId,
  url: string,
  headers: Record<string, string>,
  body: string,
  onLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await platform().llm.chatStream(provider, url, headers, body, onLine, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecrets(message, secretValuesFromHeaders(headers)));
  }
}

export async function completeOpenAiCompatible(providerId: LlmProviderId, req: LlmRequest): Promise<LlmResponse> {
  const url = OPENAI_COMPAT_CHAT_URL[providerId];
  if (!url) throw new Error(`No OpenAI-compatible endpoint configured for ${providerId}`);
  const key = await requireKey(providerId);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
  if (providerId === 'openrouter') {
    headers['HTTP-Referer'] = 'hashcerebrum://local';
    headers['X-Title'] = 'HashCerebrum';
  }
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toTextMessages(req),
    temperature: req.temperature ?? 0.4,
    stream: false,
  };
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.tools?.length) {
    body.tools = asOpenAiTools(req.tools);
    body.tool_choice = 'auto';
  }
  const data = await postJson<ProviderResponse<unknown>>(providerId, url, headers, body);
  const message = data.choices?.[0]?.message ?? {};
  const result: LlmResponse = {
    content: message.content || '',
    toolCalls: normalizeOpenAiToolCalls(message.tool_calls),
  };
  if (data.usage) {
    result.usage = { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 };
  }
  return result;
}

function ollamaOptions(req: LlmRequest): Record<string, unknown> {
  return {
    temperature: req.temperature ?? 0.4,
    num_ctx: 8192,
    // Honour the caller's output cap when given (Ollama ignores max_tokens; the
    // equivalent is options.num_predict). Omitted => Ollama's default (no cap).
    ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
  };
}

export async function completeOllama(req: LlmRequest): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
    keep_alive: 300, // LLM-002: finite keep-alive (5 min), never pin forever
    options: ollamaOptions(req),
  };
  if (req.tools?.length) body.tools = asOpenAiTools(req.tools);
  const data = await postJson<{
    message?: { content?: string; tool_calls?: unknown[] };
    prompt_eval_count?: number;
    eval_count?: number;
  }>('ollama', `${getOllamaHost()}/api/chat`, { 'Content-Type': 'application/json' }, body);
  const message = data.message ?? {};
  const acc: { inputTokens?: number; outputTokens?: number } = {};
  if (typeof data.prompt_eval_count === 'number') acc.inputTokens = data.prompt_eval_count;
  if (typeof data.eval_count === 'number') acc.outputTokens = data.eval_count;
  return {
    content: message.content || '',
    toolCalls: normalizeOpenAiToolCalls(message.tool_calls),
    ...usageResponse(acc),
  };
}

export async function completeAnthropic(req: LlmRequest): Promise<LlmResponse> {
  const key = await requireKey('anthropic');
  const system = req.messages.find((m) => m.role === 'system')?.content;
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: m.content || '' }],
    }));
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    messages,
    ...(system ? { system } : {}),
    ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
  const data = await postJson<{
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  }>(
    'anthropic',
    'https://api.anthropic.com/v1/messages',
    { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body,
  );
  const toolCalls: LlmToolCall[] = [];
  let content = '';
  for (const block of data.content ?? []) {
    if (block.type === 'text') content += block.text;
    if (block.type === 'tool_use') toolCalls.push({ id: block.id ?? '', name: block.name ?? '', args: block.input ?? {} });
  }
  const acc: { inputTokens?: number; outputTokens?: number } = {};
  if (typeof data.usage?.input_tokens === 'number') acc.inputTokens = data.usage.input_tokens;
  if (typeof data.usage?.output_tokens === 'number') acc.outputTokens = data.usage.output_tokens;
  return { content, toolCalls, ...usageResponse(acc) };
}

// Gemini's functionDeclarations schema is a restricted OpenAPI subset that
// rejects standard JSON-Schema keys (e.g. additionalProperties), 400-ing the
// whole request. Strip the keys it does not understand before sending.
function sanitizeGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeGeminiSchema);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'additionalProperties' || key === '$schema' || key === 'default') continue;
      out[key] = sanitizeGeminiSchema(entry);
    }
    return out;
  }
  return value;
}

function toGeminiBody(req: LlmRequest): Record<string, unknown> {
  const system = req.messages.find((m) => m.role === 'system')?.content;
  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }],
    }));
  return {
    contents,
    generationConfig: { temperature: req.temperature ?? 0.4 },
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(req.tools?.length
      ? {
          tools: [{
            functionDeclarations: req.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: sanitizeGeminiSchema(tool.parameters),
            })),
          }],
        }
      : {}),
  };
}

export async function completeGemini(req: LlmRequest): Promise<LlmResponse> {
  const key = await requireKey('gemini');
  const data = await postJson<unknown>(
    'gemini',
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
    { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    toGeminiBody(req),
  );
  const parsed = parseGeminiResponse(data);
  const acc: { inputTokens?: number; outputTokens?: number } = {};
  mergeUsage(acc, parsed.usage);
  return { content: parsed.delta, toolCalls: parsed.toolCalls, ...usageResponse(acc) };
}

// ----- Streaming ------------------------------------------------------
//
// Each provider speaks a slightly different streaming protocol. Rather
// than building a leaky abstraction, we ship one parser per provider
// and they all converge on the same simple shape: `onToken(text)` is
// called with each delta as it arrives, and the returned promise
// resolves with the assembled final response (so callers can keep
// using `completeWithModel` shapes downstream).

export interface StreamOptions {
  onToken: (delta: string) => void;
  signal?: AbortSignal | undefined;
}

export async function streamOllama(req: LlmRequest, opts: StreamOptions): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    keep_alive: 300, // LLM-002: finite keep-alive (5 min), never pin forever
    options: ollamaOptions(req),
  };
  if (req.tools?.length) body.tools = asOpenAiTools(req.tools);
  let content = '';
  let finishReason: string | undefined;
  const accumulator = new ToolCallAccumulator();
  const usageAcc: { inputTokens?: number; outputTokens?: number } = {};
  await chatStream(
    'ollama',
    `${getOllamaHost()}/api/chat`,
    { 'Content-Type': 'application/json' },
    JSON.stringify(body),
    (line) => {
      const parsed = parseOllamaStreamLine(line);
      if (!parsed) return;
      if (parsed.delta) {
        content += parsed.delta;
        opts.onToken(parsed.delta);
      }
      if (parsed.finishReason) finishReason = parsed.finishReason;
      mergeUsage(usageAcc, parsed.usage);
      accumulator.ingest(parsed.toolCallDeltas);
    },
    opts.signal,
  );
  return { content, toolCalls: accumulator.collect(), ...(finishReason ? { finishReason } : {}), ...usageResponse(usageAcc) };
}

export async function streamOpenAiCompatible(providerId: LlmProviderId, req: LlmRequest, opts: StreamOptions): Promise<LlmResponse> {
  const url = OPENAI_COMPAT_CHAT_URL[providerId];
  if (!url) throw new Error(`No OpenAI-compatible endpoint configured for ${providerId}`);
  const key = await requireKey(providerId);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${key}`,
  };
  if (providerId === 'openrouter') {
    headers['HTTP-Referer'] = 'hashcerebrum://local';
    headers['X-Title'] = 'HashCerebrum';
  }
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toTextMessages(req),
    temperature: req.temperature ?? 0.4,
    stream: true,
    // Ask for a final usage chunk with the real token counts. Most
    // OpenAI-compatible providers honour this; the rest ignore the field.
    stream_options: { include_usage: true },
  };
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.tools?.length) {
    body.tools = asOpenAiTools(req.tools);
    body.tool_choice = 'auto';
  }
  let content = '';
  let finishReason: string | undefined;
  const accumulator = new ToolCallAccumulator();
  const usageAcc: { inputTokens?: number; outputTokens?: number } = {};
  await chatStream(providerId, url, headers, JSON.stringify(body), (line) => {
    const parsed = parseOpenAiStreamLine(line);
    if (!parsed) return;
    if (parsed.delta) {
      content += parsed.delta;
      opts.onToken(parsed.delta);
    }
    if (parsed.finishReason) finishReason = parsed.finishReason;
    mergeUsage(usageAcc, parsed.usage);
    accumulator.ingest(parsed.toolCallDeltas);
  }, opts.signal);
  return { content, toolCalls: accumulator.collect(), ...(finishReason ? { finishReason } : {}), ...usageResponse(usageAcc) };
}

export async function streamAnthropic(req: LlmRequest, opts: StreamOptions): Promise<LlmResponse> {
  const key = await requireKey('anthropic');
  const system = req.messages.find((m) => m.role === 'system')?.content;
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: m.content || '' }],
    }));
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    stream: true,
    messages,
    ...(system ? { system } : {}),
    ...(typeof req.temperature === 'number' ? { temperature: req.temperature } : {}),
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
  let content = '';
  let finishReason: string | undefined;
  const accumulator = new ToolCallAccumulator();
  const usageAcc: { inputTokens?: number; outputTokens?: number } = {};
  await chatStream(
    'anthropic',
    'https://api.anthropic.com/v1/messages',
    {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    JSON.stringify(body),
    (line) => {
      const parsed = parseAnthropicStreamLine(line);
      if (!parsed) return;
      if (parsed.finishReason) finishReason = parsed.finishReason;
      if (parsed.delta) {
        content += parsed.delta;
        opts.onToken(parsed.delta);
      }
      mergeUsage(usageAcc, parsed.usage);
      accumulator.ingest(parsed.toolCallDeltas);
    },
    opts.signal,
  );
  return { content, toolCalls: accumulator.collect(), ...(finishReason ? { finishReason } : {}), ...usageResponse(usageAcc) };
}

export async function streamGemini(req: LlmRequest, opts: StreamOptions): Promise<LlmResponse> {
  const key = await requireKey('gemini');
  let content = '';
  let finishReason: string | undefined;
  const toolCalls: LlmToolCall[] = [];
  const usageAcc: { inputTokens?: number; outputTokens?: number } = {};
  await chatStream(
    'gemini',
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
    {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-goog-api-key': key,
    },
    JSON.stringify(toGeminiBody(req)),
    (line) => {
      const parsed = parseGeminiStreamLine(line);
      if (!parsed) return;
      if (parsed.delta) {
        content += parsed.delta;
        opts.onToken(parsed.delta);
      }
      if (parsed.finishReason) finishReason = parsed.finishReason;
      mergeUsage(usageAcc, parsed.usage);
      toolCalls.push(...parsed.toolCalls);
    },
    opts.signal,
  );
  return { content, toolCalls, ...(finishReason ? { finishReason } : {}), ...usageResponse(usageAcc) };
}
