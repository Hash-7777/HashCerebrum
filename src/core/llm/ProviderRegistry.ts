import { platform } from '@platform/index';
import { DEFAULT_MODEL, PROVIDER_DEFS, parseModelRef, providerKeyName } from './modelCatalog';
import {
  findBestFailover,
  isHardProviderError,
  isRetriableError,
  shouldRetrySameProvider,
  type FailoverCandidate,
} from './failover';
import { allDiscoveredModels, useModelCatalogStore } from '@core/store/modelCatalogStore';
import { OPENAI_COMPAT_CHAT_URL } from './providerEndpoints';
import { getOllamaHost, getPrivacyLocalOnly } from './providerSettings';
import {
  normalizeOpenAiToolCalls,
  parseAnthropicStreamLine,
  parseGeminiResponse,
  parseGeminiStreamLine,
  parseOllamaStreamLine,
  parseOpenAiStreamLine,
} from './streamParsers';
import type { LlmProvider, LlmProviderId, LlmRequest, LlmResponse, LlmToolCall, LlmToolSpec } from './types';

export { getOllamaHost, getPrivacyLocalOnly, setOllamaHost, setPrivacyLocalOnly } from './providerSettings';

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
  const key = await platform().keychain.retrieve(keyName);
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

async function completeOpenAiCompatible(providerId: LlmProviderId, req: LlmRequest): Promise<LlmResponse> {
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
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), referrerPolicy: 'no-referrer' });
  if (!response.ok) {
    throw new Error(`${providerId} HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  const data = await response.json();
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

async function completeOllama(req: LlmRequest): Promise<LlmResponse> {
  const response = await fetch(`${getOllamaHost()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      keep_alive: -1,
      tools: req.tools?.length ? asOpenAiTools(req.tools) : undefined,
      options: { temperature: req.temperature ?? 0.4, num_ctx: 8192 },
    }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  const data = await response.json();
  const message = data.message ?? {};
  return {
    content: message.content || '',
    toolCalls: normalizeOpenAiToolCalls(message.tool_calls),
  };
}

async function completeAnthropic(req: LlmRequest): Promise<LlmResponse> {
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
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error(`anthropic HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  const data = await response.json();
  const toolCalls: LlmToolCall[] = [];
  let content = '';
  for (const block of data.content ?? []) {
    if (block.type === 'text') content += block.text;
    if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
  }
  return { content, toolCalls };
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
              parameters: tool.parameters,
            })),
          }],
        }
      : {}),
  };
}

async function completeGemini(req: LlmRequest): Promise<LlmResponse> {
  const key = await requireKey('gemini');
  const body = toGeminiBody(req);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      referrerPolicy: 'no-referrer',
    },
  );
  if (!response.ok) throw new Error(`gemini HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  const data = await response.json();
  const parsed = parseGeminiResponse(data);
  return { content: parsed.delta, toolCalls: parsed.toolCalls };
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
  signal?: AbortSignal;
}

async function readStream(response: Response, parse: (chunk: string) => void) {
  if (!response.body) throw new Error('Streaming response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Split on newline; SSE uses double-newline event boundaries but a
    // single \n boundary is safe to handle line-by-line since each line
    // is independently parseable.
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) parse(line);
      nl = buffer.indexOf('\n');
    }
  }
  if (buffer.trim()) parse(buffer.trim());
}

async function streamOllama(req: LlmRequest, opts: StreamOptions): Promise<LlmResponse> {
  const response = await fetch(`${getOllamaHost()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      keep_alive: -1,
      tools: req.tools?.length ? asOpenAiTools(req.tools) : undefined,
      options: { temperature: req.temperature ?? 0.4, num_ctx: 8192 },
    }),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  let content = '';
  const toolCalls: LlmToolCall[] = [];
  await readStream(response, (line) => {
    const parsed = parseOllamaStreamLine(line);
    if (!parsed) return;
    if (parsed.delta) {
      content += parsed.delta;
      opts.onToken(parsed.delta);
    }
    toolCalls.push(...parsed.toolCalls);
  });
  return { content, toolCalls };
}

async function streamOpenAiCompatible(providerId: LlmProviderId, req: LlmRequest, opts: StreamOptions): Promise<LlmResponse> {
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
  };
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.tools?.length) {
    body.tools = asOpenAiTools(req.tools);
    body.tool_choice = 'auto';
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    referrerPolicy: 'no-referrer',
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!response.ok) throw new Error(`${providerId} HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);

  let content = '';
  const toolCalls: LlmToolCall[] = [];
  await readStream(response, (line) => {
    const parsed = parseOpenAiStreamLine(line);
    if (!parsed) return;
    if (parsed.delta) {
      content += parsed.delta;
      opts.onToken(parsed.delta);
    }
    toolCalls.push(...parsed.toolCalls);
  });
  return { content, toolCalls };
}

async function streamAnthropic(req: LlmRequest, opts: StreamOptions): Promise<LlmResponse> {
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
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    referrerPolicy: 'no-referrer',
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!response.ok) throw new Error(`anthropic HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);

  let content = '';
  await readStream(response, (line) => {
    const parsed = parseAnthropicStreamLine(line);
    if (!parsed?.delta) return;
    content += parsed.delta;
    opts.onToken(parsed.delta);
  });
  return { content, toolCalls: [] };
}

async function streamGemini(req: LlmRequest, opts: StreamOptions): Promise<LlmResponse> {
  const key = await requireKey('gemini');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(toGeminiBody(req)),
      referrerPolicy: 'no-referrer',
      ...(opts.signal ? { signal: opts.signal } : {}),
    },
  );
  if (!response.ok) throw new Error(`gemini HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);

  let content = '';
  const toolCalls: LlmToolCall[] = [];
  await readStream(response, (line) => {
    const parsed = parseGeminiStreamLine(line);
    if (!parsed) return;
    if (parsed.delta) {
      content += parsed.delta;
      opts.onToken(parsed.delta);
    }
    toolCalls.push(...parsed.toolCalls);
  });
  return { content, toolCalls };
}

export async function streamWithModel(
  modelValue: string,
  req: Omit<LlmRequest, 'model'>,
  opts: StreamOptions,
): Promise<LlmResponse> {
  const parsed = parseModelRef(modelValue || DEFAULT_MODEL);
  if (parsed.kind === 'cloud' && getPrivacyLocalOnly()) {
    throw new Error('Privacy Local Only is enabled. Select an Ollama model or turn it off in Settings.');
  }
  const request = { ...req, model: parsed.model };
  if (parsed.provider === 'ollama') return streamOllama(request, opts);
  if (parsed.provider === 'anthropic') return streamAnthropic(request, opts);
  if (parsed.provider === 'gemini') return streamGemini(request, opts);
  return streamOpenAiCompatible(parsed.provider, request, opts);
}

// Streaming variant of completeWithModelChain — same failover semantics
// applied to a streaming endpoint. We do not retry once the stream has
// started emitting tokens (a partial response is not retriable).
export async function streamWithModelChain(
  modelValue: string,
  req: Omit<LlmRequest, 'model'>,
  opts: StreamOptions,
  onProgress?: (progress: FailoverProgress) => void,
): Promise<FailoverResult> {
  const tried = new Set<string>();
  let current = modelValue || DEFAULT_MODEL;
  let lastError: unknown;
  const switchedTo: string[] = [];

  const keyCache = new Map<LlmProviderId, boolean>();
  const providerRetries = new Map<LlmProviderId, number>();
  const hasKey = async (provider: LlmProviderId) => {
    let cached = keyCache.get(provider);
    if (cached === undefined) {
      cached = await hasStoredKey(provider);
      keyCache.set(provider, cached);
    }
    return cached;
  };
  const hasKeySync = (provider: LlmProviderId) => keyCache.get(provider) === true;
  await Promise.all(PROVIDER_DEFS.filter((g) => !!g.keyName).map((g) => hasKey(g.provider)));
  const modelGroups = useModelCatalogStore.getState().groups;

  let failovers = 0;
  while (failovers <= MAX_FAILOVERS) {
    tried.add(current);
    let receivedAny = false;
    try {
      const response = await streamWithModel(current, req, {
        onToken: (token) => {
          receivedAny = true;
          opts.onToken(token);
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      return {
        ...response,
        modelUsed: current,
        failover: { attempted: switchedTo.length, switchedTo },
      };
    } catch (error) {
      lastError = error;
      if (receivedAny) break; // mid-stream failure — cannot retry without duplicating tokens
      const parsed = parseModelRef(current);
      const retries = providerRetries.get(parsed.provider) ?? 0;
      if (shouldRetrySameProvider(error) && retries < 1) {
        providerRetries.set(parsed.provider, retries + 1);
        await delay(RETRY_WAIT_MS);
        continue;
      }
      if (!isRetriableError(error) && !isHardProviderError(error)) break;
      const next = findBestFailover(current, tried, hasKeySync, modelGroups);
      if (!next) break;
      failovers++;
      switchedTo.push(next.value);
      onProgress?.({
        from: current,
        to: next,
        attempt: failovers,
        reason: error instanceof Error ? error.message : String(error),
      });
      current = next.value;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'unknown LLM error'));
}

// Default-model resolver — used by BrainMode on mount. Order:
//   1. If Ollama has a loaded model (warm via /api/ps), prefer that.
//   2. Else, pick the first freshly discovered model in the dynamic catalog.
//   3. Else fall back to the local default value.
// This mirrors the HashCortX `defaultLLM()` UX so the user doesn't see
// a "no key" wall on first launch when they already have Ollama running.
export async function resolveDefaultModel(): Promise<string> {
  // Ollama check — fast, no auth, fails closed on connection errors.
  try {
    const res = await fetch(`${getOllamaHost()}/api/ps`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const loaded = Array.isArray(data?.models) ? data.models : Array.isArray(data?.processes) ? data.processes : [];
      const first: unknown = loaded[0]?.model ?? loaded[0]?.name;
      if (typeof first === 'string' && first.length > 0) {
        return `local:ollama:${first}`;
      }
    }
  } catch {
    /* no local Ollama running — fall through */
  }

  const discovered = allDiscoveredModels();
  const local = discovered.find((option) => parseModelRef(option.value).kind === 'local');
  if (local) return local.value;
  const cloud = discovered.find((option) => parseModelRef(option.value).kind === 'cloud');
  if (cloud) return cloud.value;

  return DEFAULT_MODEL;
}

export async function completeWithModel(modelValue: string, req: Omit<LlmRequest, 'model'>): Promise<LlmResponse> {
  const parsed = parseModelRef(modelValue || DEFAULT_MODEL);
  if (parsed.kind === 'cloud' && getPrivacyLocalOnly()) {
    throw new Error('Privacy Local Only is enabled. Select an Ollama model or turn it off in Settings.');
  }
  const request = { ...req, model: parsed.model };
  if (parsed.provider === 'ollama') return completeOllama(request);
  if (parsed.provider === 'anthropic') return completeAnthropic(request);
  if (parsed.provider === 'gemini') return completeGemini(request);
  return completeOpenAiCompatible(parsed.provider, request);
}

export interface FailoverInfo {
  attempted: number;
  switchedTo: string[];
}

export interface FailoverProgress {
  from: string;
  to: FailoverCandidate;
  attempt: number;
  reason: string;
}

export interface FailoverResult extends LlmResponse {
  modelUsed: string;
  failover: FailoverInfo;
}

const MAX_FAILOVERS = 4;
const RETRY_WAIT_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hasStoredKey(provider: LlmProviderId): Promise<boolean> {
  const keyName = providerKeyName(provider);
  if (!keyName) return false;
  try {
    const value = await platform().keychain.retrieve(keyName);
    return !!value;
  } catch {
    return false;
  }
}

// completeWithModelChain — try selected model; on a retriable cloud
// failure (429 / 503 / 5xx), switch to the next-best cloud model whose
// key is available. Local models never auto-failover into the cloud.
// Returns the final response plus the chain that was walked, so the UI
// can show the user which provider actually answered.
export async function completeWithModelChain(
  modelValue: string,
  req: Omit<LlmRequest, 'model'>,
  onProgress?: (progress: FailoverProgress) => void,
): Promise<FailoverResult> {
  const tried = new Set<string>();
  let current = modelValue || DEFAULT_MODEL;
  let lastError: unknown;
  const switchedTo: string[] = [];

  const keyCache = new Map<LlmProviderId, boolean>();
  const providerRetries = new Map<LlmProviderId, number>();
  const hasKey = async (provider: LlmProviderId) => {
    let cached = keyCache.get(provider);
    if (cached === undefined) {
      cached = await hasStoredKey(provider);
      keyCache.set(provider, cached);
    }
    return cached;
  };
  const hasKeySync = (provider: LlmProviderId) => keyCache.get(provider) === true;
  await Promise.all(PROVIDER_DEFS.filter((g) => !!g.keyName).map((g) => hasKey(g.provider)));
  const modelGroups = useModelCatalogStore.getState().groups;

  let failovers = 0;
  while (failovers <= MAX_FAILOVERS) {
    tried.add(current);
    try {
      const response = await completeWithModel(current, req);
      return {
        ...response,
        modelUsed: current,
        failover: { attempted: switchedTo.length, switchedTo },
      };
    } catch (error) {
      lastError = error;
      const parsed = parseModelRef(current);
      const retries = providerRetries.get(parsed.provider) ?? 0;
      if (shouldRetrySameProvider(error) && retries < 1) {
        providerRetries.set(parsed.provider, retries + 1);
        await delay(RETRY_WAIT_MS);
        continue;
      }
      if (!isRetriableError(error) && !isHardProviderError(error)) break;
      const next = findBestFailover(current, tried, hasKeySync, modelGroups);
      if (!next) break;
      failovers++;
      switchedTo.push(next.value);
      onProgress?.({
        from: current,
        to: next,
        attempt: failovers,
        reason: error instanceof Error ? error.message : String(error),
      });
      current = next.value;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'unknown LLM error'));
}

export function getProvider(id: LlmProviderId): LlmProvider {
  const def = PROVIDER_DEFS.find((provider) => provider.provider === id) ?? PROVIDER_DEFS[0]!;
  const models = useModelCatalogStore
    .getState()
    .groups.find((group) => group.provider === id)
    ?.models.map((model) => model.value) ?? [];
  const defaultModel = models[0] ?? DEFAULT_MODEL;
  return {
    id,
    label: def.label,
    defaultModel,
    models,
    complete: (req: LlmRequest) => completeWithModel(defaultModel, req),
  };
}

export function listProviders(): LlmProvider[] {
  return PROVIDER_DEFS.map((provider) => getProvider(provider.provider));
}
