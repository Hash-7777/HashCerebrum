import { platform } from '@platform/index';
import { DEFAULT_MODEL, MODEL_GROUPS, parseModelRef, providerKeyName } from './modelCatalog';
import { findBestFailover, isRetriableError, type FailoverCandidate } from './failover';
import type { LlmProvider, LlmProviderId, LlmRequest, LlmResponse, LlmToolCall, LlmToolSpec } from './types';

const OLLAMA_HOST_KEY = 'hc.ollamaHost';
const PRIVACY_LOCAL_KEY = 'hc.privacyLocalOnly';

const OPENAI_COMPAT_URL: Partial<Record<LlmProviderId, string>> = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  cerebras: 'https://api.cerebras.ai/v1/chat/completions',
  samba: 'https://api.sambanova.ai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  moonshot: 'https://api.moonshot.ai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
};

export function getOllamaHost(): string {
  return localStorage.getItem(OLLAMA_HOST_KEY) || 'http://localhost:11434';
}

export function setOllamaHost(host: string) {
  const normalized = host.trim().replace(/\/+$/, '') || 'http://localhost:11434';
  localStorage.setItem(OLLAMA_HOST_KEY, normalized);
}

export function getPrivacyLocalOnly(): boolean {
  return localStorage.getItem(PRIVACY_LOCAL_KEY) === 'true';
}

export function setPrivacyLocalOnly(value: boolean) {
  localStorage.setItem(PRIVACY_LOCAL_KEY, String(value));
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

function parseToolArgs(args: unknown): Record<string, unknown> {
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

function normalizeOpenAiToolCalls(calls: any[] | undefined): LlmToolCall[] {
  if (!Array.isArray(calls)) return [];
  return calls
    .map((call, index) => ({
      id: call.id || `call_${Date.now()}_${index}`,
      name: call.function?.name || call.name,
      args: parseToolArgs(call.function?.arguments ?? call.arguments),
    }))
    .filter((call) => !!call.name);
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
  const url = OPENAI_COMPAT_URL[providerId];
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

async function completeGemini(req: LlmRequest): Promise<LlmResponse> {
  const key = await requireKey('gemini');
  const system = req.messages.find((m) => m.role === 'system')?.content;
  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }],
    }));
  const body: Record<string, unknown> = {
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
  let content = '';
  const toolCalls: LlmToolCall[] = [];
  for (const part of data.candidates?.[0]?.content?.parts ?? []) {
    if (part.text) content += part.text;
    if (part.functionCall) {
      toolCalls.push({
        id: `call_${Date.now()}_${toolCalls.length}`,
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      });
    }
  }
  return { content, toolCalls };
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
  const hasKey = async (provider: LlmProviderId) => {
    let cached = keyCache.get(provider);
    if (cached === undefined) {
      cached = await hasStoredKey(provider);
      keyCache.set(provider, cached);
    }
    return cached;
  };
  const hasKeySync = (provider: LlmProviderId) => keyCache.get(provider) === true;
  await Promise.all(MODEL_GROUPS.filter((g) => !!g.keyName).map((g) => hasKey(g.provider)));

  for (let attempt = 0; attempt <= MAX_FAILOVERS; attempt++) {
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
      if (!isRetriableError(error)) break;
      const next = findBestFailover(current, tried, hasKeySync);
      if (!next) break;
      switchedTo.push(next.value);
      onProgress?.({
        from: current,
        to: next,
        attempt: attempt + 1,
        reason: error instanceof Error ? error.message : String(error),
      });
      current = next.value;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'unknown LLM error'));
}

const PROVIDERS: Record<LlmProviderId, LlmProvider> = Object.fromEntries(
  MODEL_GROUPS.map((group) => [
    group.provider,
    {
      id: group.provider,
      label: group.label,
      defaultModel: group.models[0]?.value ?? DEFAULT_MODEL,
      models: group.models.map((model) => model.value),
      complete: (req: LlmRequest) => completeWithModel(group.models[0]?.value ?? DEFAULT_MODEL, req),
    },
  ]),
) as Record<LlmProviderId, LlmProvider>;

export function getProvider(id: LlmProviderId): LlmProvider {
  return PROVIDERS[id];
}

export function listProviders(): LlmProvider[] {
  return Object.values(PROVIDERS);
}
