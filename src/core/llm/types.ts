export type LlmProviderId =
  | 'ollama'
  | 'groq'
  | 'gemini'
  | 'openrouter'
  | 'cerebras'
  | 'samba'
  | 'openai'
  | 'anthropic'
  | 'moonshot'
  | 'deepseek'
  | 'mistral'
  | 'nvidia'
  | 'minimax'
  | 'xai'
  | 'together'
  | 'fireworks'
  | 'deepinfra';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface LlmToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LlmResponse {
  content: string;
  toolCalls: LlmToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  /** Provider's stop reason, when known (e.g. 'length'/'max_tokens' when the
   *  output hit the model's token cap — used to resume a capped generation). */
  finishReason?: string;
}

export interface LlmProvider {
  id: LlmProviderId;
  label: string;
  defaultModel: string;
  models: string[];
  complete(req: LlmRequest): Promise<LlmResponse>;
  stream?(req: LlmRequest, onToken: (t: string) => void): Promise<LlmResponse>;
}
