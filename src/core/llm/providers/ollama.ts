import type { LlmProvider } from '../types';

export const ollama: LlmProvider = {
  id: 'ollama',
  label: 'Ollama (local)',
  defaultModel: 'llama3.2',
  models: ['llama3.2', 'qwen2.5', 'gemma2'],
  complete: async () => ({ content: '', toolCalls: [] }),
};
