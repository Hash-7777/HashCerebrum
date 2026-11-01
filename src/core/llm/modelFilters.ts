// What counts as a model you can hold a conversation with.
//
// Providers serve pictures, speech, embeddings, re-rankers and scoring models
// from the same list as their chat models, and each says which is which in a
// field of its own — or does not say at all. A model that cannot chat must not
// reach the picker: chosen, it fails only once a question has been asked of
// it. Where a provider says nothing, the model is kept: a name is a guess, and
// a wrongly dropped model is invisible to the person looking for it.
//
// Kept apart from the fetching so the rules can be read and tested on their
// own, against the shapes the providers actually answer with.

import type { LlmProviderId } from './types';

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function boolField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asRecord(record[key]);
}

export function stringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

const NON_CHAT_MODEL = /\b(embed|embedding|rerank|moderation|safeguard|guard|image|tts|whisper|transcrib|realtime|ocr|sora|deep-research|computer-use|codex|babbage|davinci)\b/i;

// What NVIDIA also lists that holds no conversation: scoring, detection,
// document-reading, translation and search models sit beside the chat ones,
// all in the same shape.
const NVIDIA_NOT_CHAT =
  /reward|detector|parse|deplot|kosmos|clip|\bvila\b|neva|fuyu|calibration|translate|retriever|diffusion|topic-control/i;

export function supportsTextChat(provider: LlmProviderId, id: string, record: Record<string, unknown>): boolean {
  if (NON_CHAT_MODEL.test(id)) return false;
  if (boolField(record, 'archived') === true || boolField(record, 'deprecated') === true) return false;

  if (provider === 'gemini') {
    const methods = stringArray(record.supportedGenerationMethods).map((method) => method.toLowerCase());
    return methods.some((method) => method === 'generatecontent' || method === 'streamgeneratecontent');
  }

  if (provider === 'mistral') {
    const capabilities = nestedRecord(record, 'capabilities');
    if (capabilities && boolField(capabilities, 'completion_chat') === false) return false;
  }

  // Several providers serve pictures, speech and embeddings from the same list
  // as their chat models, and only a field says which is which.
  if (provider === 'together') {
    const type = stringField(record, 'type')?.toLowerCase();
    if (type && type !== 'chat' && type !== 'language') return false;
  }

  if (provider === 'deepinfra') {
    const metadata = nestedRecord(record, 'metadata');
    const tags = metadata ? stringArray(metadata.tags).map((tag) => tag.toLowerCase()) : [];
    if (tags.length > 0 && !tags.includes('chat')) return false;
  }

  if (provider === 'novita') {
    const type = stringField(record, 'model_type')?.toLowerCase();
    if (type && type !== 'chat') return false;
  }

  if (provider === 'venice') {
    const type = stringField(record, 'type')?.toLowerCase();
    if (type && type !== 'text') return false;
  }

  if (provider === 'nvidia' && NVIDIA_NOT_CHAT.test(id)) return false;

  if (provider === 'openrouter') {
    const architecture = nestedRecord(record, 'architecture');
    const modality = architecture ? stringField(architecture, 'modality') : undefined;
    const outputModalities = architecture ? stringArray(architecture.output_modalities) : [];
    if (outputModalities.length > 0 && !outputModalities.some((item) => item.toLowerCase() === 'text')) return false;
    if (modality && !modality.toLowerCase().includes('text')) return false;
  }

  return true;
}

/** Ids of the models in a provider's answer that can hold a conversation. */
export function filterChatModels(provider: LlmProviderId, records: unknown[]): string[] {
  return records
    .map((raw) => asRecord(raw))
    .filter((record): record is Record<string, unknown> => record !== null)
    .map((record) => ({
      record,
      id: stringField(record, 'id') ?? stringField(record, 'name') ?? stringField(record, 'model'),
    }))
    .filter((entry): entry is { record: Record<string, unknown>; id: string } => !!entry.id)
    .filter((entry) => supportsTextChat(provider, entry.id, entry.record))
    .map((entry) => entry.id);
}
