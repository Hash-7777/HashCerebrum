// Cloud-model failover chain — ported from HashCortX. When a cloud
// provider returns a retriable error (rate limit, overload, 5xx) we
// transparently pick the next best available model and retry. Local
// Ollama is never auto-failed-over to the cloud because that would
// violate the Privacy Local Only contract.
//
// "Tier" is a coarse capability ranking so the next model picked is at
// least as capable as the one that failed; if none are free we degrade
// one tier at a time. Free-tier providers are preferred at equal tier
// to avoid burning paid credit on a hot path.

import { parseModelRef, type ModelGroup } from './modelCatalog';
import type { LlmProviderId } from './types';

export interface FailoverCandidate {
  value: string;
  label: string;
  shortLabel: string;
  provider: LlmProviderId;
  tier: number;
}

const FREE_PREFERRED: Partial<Record<LlmProviderId, number>> = {
  groq: 1,
  gemini: 1,
  cerebras: 1,
  samba: 1,
  openrouter: 1,
};

// Heuristic ladder so a failed flagship cloud model picks something at
// least as strong before degrading. Strings are matched substring-style
// against the model id (case-insensitive) so we don't have to enumerate
// every variant.
const TIER_RULES: { match: RegExp; tier: number }[] = [
  { match: /opus|gpt-?5|o3-(pro|max)|nemotron-ultra|gpt-oss-120b/i, tier: 400 },
  { match: /sonnet|gpt-4o|gemini-2\.5-pro|llama-3\.3-70b|llama-4|maverick|deepseek-v3|kimi-k2|mistral-large/i, tier: 300 },
  { match: /haiku|gpt-4o-mini|o3-mini|gemini-2\.5-flash|gemini-2\.0-flash|llama-3\.1-8b|deepseek-r1/i, tier: 200 },
  { match: /flash|mini|8b|7b|small/i, tier: 150 },
];

export function modelTier(modelValue: string, label = ''): number {
  for (const rule of TIER_RULES) {
    if (rule.match.test(modelValue) || rule.match.test(label)) return rule.tier;
  }
  return 100;
}

export function listCloudCandidates(
  hasKey: (provider: LlmProviderId) => boolean,
  modelGroups: ModelGroup[],
): FailoverCandidate[] {
  const out: FailoverCandidate[] = [];
  for (const group of modelGroups) {
    if (group.provider === 'ollama') continue;
    if (group.keyName && !hasKey(group.provider)) continue;
    for (const model of group.models) {
      out.push({
        value: model.value,
        label: model.label,
        shortLabel: model.shortLabel,
        provider: group.provider,
        tier: modelTier(model.value, model.label),
      });
    }
  }
  return out;
}

export function findBestFailover(
  currentModel: string,
  excluded: Set<string>,
  hasKey: (provider: LlmProviderId) => boolean,
  modelGroups: ModelGroup[],
): FailoverCandidate | null {
  const current = parseModelRef(currentModel);
  if (current.kind !== 'cloud') return null;
  const currentTier = modelTier(currentModel);
  const available = listCloudCandidates(hasKey, modelGroups).filter(
    (candidate) => candidate.value !== currentModel && !excluded.has(candidate.value),
  );
  if (available.length === 0) return null;
  available.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    return (FREE_PREFERRED[b.provider] ?? 0) - (FREE_PREFERRED[a.provider] ?? 0);
  });
  return (
    available.find((c) => c.tier >= currentTier) ??
    available.find((c) => c.tier >= currentTier - 50) ??
    available[0] ??
    null
  );
}

// Billing/credit errors (402, "insufficient credits") are retriable in the
// sense that the chain should fail OVER to another provider — just never
// retried on the same provider (QUOTA blocks that in shouldRetrySameProvider).
const RETRIABLE = /\b(rate ?limit|quota|too many|capacity|overloaded|unavailable|timeout|timed ?out|network|failed to fetch|server error|insufficient ?credits|payment ?required|billing|402|429|503|529|502|504)\b|HTTP 5\d\d/i;
const SAME_PROVIDER_RETRY = /\b(rate ?limit|too many|capacity|overloaded|temporar|try again|timeout|timed ?out|network|failed to fetch|429|503|529|502|504)\b|HTTP 5\d\d/i;
const QUOTA = /\b(quota|free ?tier|insufficient ?credits|billing|exceeded)\b/i;
const HARD_PROVIDER = /tool.{0,10}call(ing)?.{0,10}(not supported|unsupported|unavailable|disabled)|function.{0,10}call(ing)?.{0,10}not supported|does not support.{0,10}tool|tools?.{0,10}not.{0,10}supported|invalid_request_error|jsondecodeerror|expecting property name enclosed in double quotes|invalid.{0,20}(tool|function).{0,20}(json|arguments)|context.{0,10}length|maximum.{0,10}token|model.{0,10}not.{0,10}found|no such model/i;

export function isRetriableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return RETRIABLE.test(message);
}

export function isHardProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return HARD_PROVIDER.test(message);
}

export function shouldRetrySameProvider(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return SAME_PROVIDER_RETRY.test(message) && !QUOTA.test(message);
}
