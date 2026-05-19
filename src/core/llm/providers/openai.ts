import type { LlmProvider } from '../types';

export const openai: LlmProvider = {
  id: 'openai',
  label: 'OpenAI',
  defaultModel: 'gpt-4o',
  models: ['gpt-4o', 'gpt-4o-mini'],
  complete: async () => ({ content: '', toolCalls: [] }),
};
