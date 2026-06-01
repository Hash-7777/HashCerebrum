import { platform } from '@platform/index';
import { DEFAULT_MODEL, PROVIDER_DEFS, parseModelRef, providerKeyName } from './modelCatalog';
import {
  cooldownProvider,
  findBestFailover,
  isBillingError,
  isHardProviderError,
  isProviderOnCooldown,
  isRetriableError,
  shouldRetrySameProvider,
  type FailoverCandidate,
} from './failover';
import { allDiscoveredModels, useModelCatalogStore } from '@core/store/modelCatalogStore';
import { OPENAI_COMPAT_CHAT_URL } from './providerEndpoints';
import { getOllamaHost, getPrivacyLocalOnly } from './providerSettings';
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
  const data = await postJson<{
    choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }>(providerId, url, headers, body);
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

async function completeOllama(req: LlmRequest): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
    keep_alive: -1,
    options: ollamaOptions(req),
  };
  if (req.tools?.length) body.tools = asOpenAiTools(req.tools);
  const data = await postJson<{ message?: { content?: string; tool_calls?: unknown[] } }>(
    'ollama',
    `${getOllamaHost()}/api/chat`,
    { 'Content-Type': 'application/json' },
    body,
  );
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
  const data = await postJson<{
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
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
  return { content, toolCalls };
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

async function completeGemini(req: LlmRequest): Promise<LlmResponse> {
  const key = await requireKey('gemini');
  const data = await postJson<unknown>(
    'gemini',
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
    { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    toGeminiBody(req),
  );
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
  signal?: AbortSignal | undefined;
}

async function streamOllama(req: LlmRequest, opts: StreamOptions): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    keep_alive: -1,
    options: ollamaOptions(req),
  };
  if (req.tools?.length) body.tools = asOpenAiTools(req.tools);
  let content = '';
  const accumulator = new ToolCallAccumulator();
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
      accumulator.ingest(parsed.toolCallDeltas);
    },
    opts.signal,
  );
  return { content, toolCalls: accumulator.collect() };
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
  let content = '';
  const accumulator = new ToolCallAccumulator();
  await chatStream(providerId, url, headers, JSON.stringify(body), (line) => {
    const parsed = parseOpenAiStreamLine(line);
    if (!parsed) return;
    if (parsed.delta) {
      content += parsed.delta;
      opts.onToken(parsed.delta);
    }
    accumulator.ingest(parsed.toolCallDeltas);
  }, opts.signal);
  return { content, toolCalls: accumulator.collect() };
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
  let content = '';
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
      if (!parsed?.delta) return;
      content += parsed.delta;
      opts.onToken(parsed.delta);
    },
    opts.signal,
  );
  return { content, toolCalls: [] };
}

async function streamGemini(req: LlmRequest, opts: StreamOptions): Promise<LlmResponse> {
  const key = await requireKey('gemini');
  let content = '';
  const toolCalls: LlmToolCall[] = [];
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
      toolCalls.push(...parsed.toolCalls);
    },
    opts.signal,
  );
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

// Handed to the next model when a stream is cut off mid-answer, so the switch
// is seamless instead of truncating (cf. switching Opus→Sonnet mid-task).
const CONTINUE_INSTRUCTION =
  'Your previous response was cut off mid-stream. Continue it from exactly where it stopped. ' +
  'Do not repeat any text you already wrote, do not restart, and do not add any preamble — ' +
  'resume seamlessly with the very next word.';

// Streaming variant of completeWithModelChain. On a retriable failure BEFORE any
// token is emitted, it restarts fresh on the next model. On a retriable failure
// AFTER tokens have streamed, it now RESUMES the answer on the next model
// (feeding it what was written so far) rather than truncating — so a mid-stream
// model switch reads as one continuous answer.
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
  let acc = ''; // everything emitted so far, across every model leg
  let resuming = false; // true once we are continuing a cut-off response
  while (failovers <= MAX_FAILOVERS) {
    // If the preferred model's provider is cooling down from a recent rate
    // limit / credit failure, fail over immediately rather than re-hitting it.
    if (!tried.has(current) && isProviderOnCooldown(parseModelRef(current).provider)) {
      let warm = findBestFailover(current, tried, hasKeySync, modelGroups);
      while (warm && isProviderOnCooldown(warm.provider)) {
        tried.add(warm.value);
        warm = findBestFailover(current, tried, hasKeySync, modelGroups);
      }
      if (warm) {
        tried.add(current);
        failovers++;
        switchedTo.push(warm.value);
        onProgress?.({ from: current, to: warm, attempt: failovers, reason: 'provider cooling down from a recent rate limit' });
        current = warm.value;
      }
    }
    tried.add(current);

    // On a continuation leg, give the next model what was written so far and ask
    // it to resume seamlessly. Rebuild the request with only prose fields — tools
    // are intentionally dropped (this is a prose continuation, not tool calling).
    let legReq: Omit<LlmRequest, 'model'> = req;
    if (resuming) {
      legReq = {
        messages: [
          ...req.messages,
          { role: 'assistant', content: acc },
          { role: 'user', content: CONTINUE_INSTRUCTION },
        ],
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
      };
    }

    let receivedThisLeg = false;
    try {
      const response = await streamWithModel(current, legReq, {
        onToken: (token) => {
          receivedThisLeg = true;
          acc += token;
          opts.onToken(token);
        },
        signal: opts.signal,
      });
      return {
        ...response,
        content: acc, // full answer across all legs, not just the last one
        modelUsed: current,
        failover: { attempted: switchedTo.length, switchedTo },
      };
    } catch (error) {
      lastError = error;
      if (opts.signal?.aborted) break;
      const parsed = parseModelRef(current);

      if (receivedThisLeg) {
        // Mid-stream interruption. If retriable and budget remains, RESUME the
        // answer on another model rather than truncating it.
        if (!isRetriableError(error) && !isHardProviderError(error)) break;
        cooldownProvider(parsed.provider, error);
        let cont = findBestFailover(current, tried, hasKeySync, modelGroups);
        while (cont && isProviderOnCooldown(cont.provider)) {
          tried.add(cont.value);
          cont = findBestFailover(current, tried, hasKeySync, modelGroups);
        }
        if (!cont) break;
        failovers++;
        switchedTo.push(cont.value);
        onProgress?.({ from: current, to: cont, attempt: failovers, reason: 'resuming after a mid-stream interruption' });
        current = cont.value;
        resuming = true;
        continue;
      }

      // No tokens yet on this leg — safe to restart fresh on the same/next model.
      const retries = providerRetries.get(parsed.provider) ?? 0;
      if (shouldRetrySameProvider(error) && retries < 1) {
        providerRetries.set(parsed.provider, retries + 1);
        await delay(RETRY_WAIT_MS);
        continue;
      }
      if (!isRetriableError(error) && !isHardProviderError(error)) break;
      // Park a rate-limited / out-of-credits provider so later calls skip it.
      cooldownProvider(parsed.provider, error);
      if (isBillingError(error)) {
        // A billing/credit failure is account-wide — abandon every model
        // from this provider so the chain escapes to a working one.
        for (const group of modelGroups) {
          if (group.provider === parsed.provider) {
            for (const model of group.models) tried.add(model.value);
          }
        }
      }
      let next = findBestFailover(current, tried, hasKeySync, modelGroups);
      while (next && isProviderOnCooldown(next.provider)) {
        tried.add(next.value);
        next = findBestFailover(current, tried, hasKeySync, modelGroups);
      }
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

  // Budget/abort exhausted. If a partial answer already streamed, return it (the
  // user can see it — better than discarding); otherwise surface the error.
  if (acc) {
    return { content: acc, toolCalls: [], modelUsed: current, failover: { attempted: switchedTo.length, switchedTo } };
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
    const { status, body } = await platform().llm.httpGet('ollama', `${getOllamaHost()}/api/ps`, {});
    if (status >= 200 && status < 300) {
      const data = JSON.parse(body);
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
    // If the preferred model's provider is cooling down from a recent rate
    // limit / credit failure, fail over immediately rather than re-hitting it.
    if (!tried.has(current) && isProviderOnCooldown(parseModelRef(current).provider)) {
      let warm = findBestFailover(current, tried, hasKeySync, modelGroups);
      while (warm && isProviderOnCooldown(warm.provider)) {
        tried.add(warm.value);
        warm = findBestFailover(current, tried, hasKeySync, modelGroups);
      }
      if (warm) {
        tried.add(current);
        failovers++;
        switchedTo.push(warm.value);
        onProgress?.({ from: current, to: warm, attempt: failovers, reason: 'provider cooling down from a recent rate limit' });
        current = warm.value;
      }
    }
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
      // Park a rate-limited / out-of-credits provider so later calls skip it.
      cooldownProvider(parsed.provider, error);
      if (isBillingError(error)) {
        // A billing/credit failure is account-wide — abandon every model
        // from this provider so the chain escapes to a working one.
        for (const group of modelGroups) {
          if (group.provider === parsed.provider) {
            for (const model of group.models) tried.add(model.value);
          }
        }
      }
      let next = findBestFailover(current, tried, hasKeySync, modelGroups);
      while (next && isProviderOnCooldown(next.provider)) {
        tried.add(next.value);
        next = findBestFailover(current, tried, hasKeySync, modelGroups);
      }
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
