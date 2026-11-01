// What a provider's model list offers the picker.
//
// Several providers serve pictures, speech, embeddings and scoring models from
// the same list as their chat models, and say which is which in a field of
// their own. A model that cannot hold a conversation must not reach the
// picker: chosen, it fails only when a question is asked of it.

import { describe, expect, it } from 'vitest';
import { filterChatModels } from '../modelFilters';

describe('filterChatModels', () => {
  it('keeps chat and language models from a mixed list, and drops the rest', () => {
    const kept = filterChatModels('together', [
      { id: 'a-chat-model', type: 'chat' },
      { id: 'a-language-model', type: 'language' },
      { id: 'a-picture-model', type: 'image' },
      { id: 'a-speech-model', type: 'audio' },
    ]);
    expect(kept).toEqual(['a-chat-model', 'a-language-model']);
  });

  it('reads the tag a model carries where that is the only signal', () => {
    const kept = filterChatModels('deepinfra', [
      { id: 'talks', metadata: { tags: ['chat', 'text-generation'] } },
      { id: 'draws', metadata: { tags: ['text-to-image'] } },
      { id: 'unlabelled' },
    ]);
    expect(kept).toEqual(['talks', 'unlabelled']);
  });

  it('reads the field each provider uses', () => {
    expect(filterChatModels('novita', [{ id: 'keep', model_type: 'chat' }, { id: 'drop', model_type: 'embedding' }])).toEqual(['keep']);
    expect(filterChatModels('venice', [{ id: 'keep', type: 'text' }, { id: 'drop', type: 'image' }])).toEqual(['keep']);
  });

  it('drops the scoring and reading models that sit beside NVIDIA chat models', () => {
    const kept = filterChatModels('nvidia', [
      { id: 'meta/llama-3.1-70b-instruct' },
      { id: 'nvidia/nemotron-4-340b-reward' },
      { id: 'google/deplot' },
      { id: 'nvidia/rerank-qa-mistral-4b' },
    ]);
    expect(kept).toEqual(['meta/llama-3.1-70b-instruct']);
  });

  it('keeps a model a provider says nothing about', () => {
    expect(filterChatModels('groq', [{ id: 'llama-3.3-70b-versatile' }])).toEqual([
      'llama-3.3-70b-versatile',
    ]);
  });
});
