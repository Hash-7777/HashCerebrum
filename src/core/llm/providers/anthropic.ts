import type { LlmProvider } from '../types';

// Implementation deferred to Phase 3. Stub returns model metadata so the
// settings UI can render the provider before integration is wired.
export const anthropic: LlmProvider = {
  id: 'anthropic',
  label: 'Anthropic',
  defaultModel: 'claude-opus-4-7',
  models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  complete: async () => ({ content: '', toolCalls: [] }),
};
