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

import { isBillingDead, isRateLimited } from './errorKind';
import { parseModelRef, type ModelGroup } from './modelCatalog';
import type { LlmProviderId } from './types';

export interface FailoverCandidate {
  value: string;
  label: string;
  shortLabel: string;
  provider: LlmProviderId;
  tier: number;
  supportsTools?: boolean;
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
    // A provider that returned a hard 402 / "insufficient credits" is dead for
    // the whole session — never offer it again to failover or auto-assignment,
    // so the chain stops re-attempting an unfunded key on every section.
    if (billingDeadProviders.has(group.provider)) continue;
    for (const model of group.models) {
      // A model known to be gone/inaccessible this session is never a candidate.
      if (unusableModels.has(model.value)) continue;
      out.push({
        value: model.value,
        label: model.label,
        shortLabel: model.shortLabel,
        provider: group.provider,
        tier: modelTier(model.value, model.label),
        ...(model.supportsTools !== undefined ? { supportsTools: model.supportsTools } : {}),
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
  needsTools = false,
): FailoverCandidate | null {
  const current = parseModelRef(currentModel);
  if (current.kind !== 'cloud') return null;
  const currentTier = modelTier(currentModel);
  let available = listCloudCandidates(hasKey, modelGroups).filter(
    (candidate) => candidate.value !== currentModel && !excluded.has(candidate.value),
  );
  // When the failed call uses tools, don't hand it to a model we positively know
  // can't tool-call (it would just hard-fail again). Unknown stays eligible; if
  // the filter would empty the pool, keep all so the chain can still progress.
  if (needsTools) {
    const toolCapable = available.filter((candidate) => candidate.supportsTools !== false);
    if (toolCapable.length > 0) available = toolCapable;
  }
  if (available.length === 0) return null;
  available.sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    // Prefer a DIFFERENT provider than the one that just failed, so failover
    // spreads load to a fresh key instead of hammering another model on the
    // same (usually rate-limited) provider.
    const aFresh = a.provider !== current.provider ? 1 : 0;
    const bFresh = b.provider !== current.provider ? 1 : 0;
    if (aFresh !== bFresh) return bFresh - aFresh;
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
const RETRIABLE = /\b(rate ?limit|quota|too many|capacity|overloaded|unavailable|timeout|timed ?out|network|failed to fetch|server error|insufficient ?credits|payment ?required|billing|402|429|503|529|502|504)\b|HTTP 5\d\d|jsondecodeerror|expecting property name enclosed in double quotes/i;
const SAME_PROVIDER_RETRY = /\b(rate ?limit|too many|capacity|overloaded|temporar|try again|timeout|timed ?out|network|failed to fetch|429|503|529|502|504)\b|HTTP 5\d\d/i;
const QUOTA = /\b(quota|free ?tier|insufficient ?credits|billing|exceeded)\b/i;
const HARD_PROVIDER = /tool.{0,10}call(ing)?.{0,10}(not supported|unsupported|unavailable|disabled)|function.{0,10}call(ing)?.{0,10}not supported|does not support.{0,10}tool|tools?.{0,10}not.{0,10}supported|invalid_request_error|invalid.{0,20}(tool|function).{0,20}(json|arguments)|context.{0,10}length|maximum.{0,10}token|model.{0,10}not.{0,10}found|no such model/i;

export function isRetriableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return RETRIABLE.test(message);
}

export function isHardProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return HARD_PROVIDER.test(message);
}

// Account-level billing failures (no credits / payment required). The whole
// provider is dead, not just one model — the chain must abandon every model
// from that provider, not just fail over to a sibling model.
//
// Delegates to the shared classifier, which also refuses to call a message
// billing-dead when it reads as a rate limit. Several providers word a
// free-tier throttle in billing language, and retiring a whole provider for the
// session over a transient 429 is the expensive mistake.
export function isBillingError(error: unknown): boolean {
  return isBillingDead(error);
}

export function shouldRetrySameProvider(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return SAME_PROVIDER_RETRY.test(message) && !QUOTA.test(message);
}

// ── Empty replies ────────────────────────────────────────────────────────────
// A provider can answer "successfully" with no text and no tool call. The usual
// cause is a model that reasons before it writes: the reasoning counts against
// the output cap, the cap runs out before the first answer word, and the reply
// ends with a length stop and nothing in it. A content filter can do the same
// with a normal stop. Neither is an error the transport sees, so the chain has
// to recognise it here — handing an empty string on reads to the user as "the
// app produced nothing".

export type EmptyReplyAction = 'none' | 'raise-budget' | 'fail-over';

/** What the model chain should do with a reply. A length-stopped empty reply
 *  gets one retry on the same model with a larger output cap; any other empty
 *  reply (or one that stays empty after that retry) moves to another model. */
export function emptyReplyAction(
  reply: { content: string; toolCalls?: readonly unknown[]; finishReason?: string },
  budgetAlreadyRaised: boolean,
): EmptyReplyAction {
  if (reply.content.trim().length > 0 || (reply.toolCalls?.length ?? 0) > 0) return 'none';
  const stop = (reply.finishReason ?? '').toLowerCase();
  const lengthStop = stop === 'length' || stop === 'max_tokens';
  return lengthStop && !budgetAlreadyRaised ? 'raise-budget' : 'fail-over';
}

/** The output cap for the retry after a length-stopped empty reply: enough room
 *  for the reasoning AND the answer, and never below the caller's own cap. */
export function raisedTokenBudget(maxTokens: number | undefined): number {
  const base = maxTokens ?? 2000;
  return Math.min(16_000, Math.max(base * 3, 6000));
}

// ── Unusable-model registry ──────────────────────────────────────────────────
// A single model that is gone or not accessible to this key (decommissioned,
// renamed, retired, or not exposed to the account) should never be offered
// again — not to failover, not to auto-assignment, not in the picker. This is
// per-MODEL and permanent for the session; it is deliberately NARROW: a transient
// 429/503/overload/timeout does NOT mean the model is dead (it is just busy), so
// those are excluded here and handled by the cooldown path instead. Provider-wide
// auth failures (bad key → 401/403) are also excluded — that is a key problem,
// not a model problem, and belongs to the billing/key handling.
// NOTE: a bare `404` is deliberately NOT one of these alternatives. A 404 is
// returned for a mistyped endpoint path, a proxy that does not know the route,
// and a provider's own routing hiccup — none of which mean the model is gone,
// yet any of them would retire it for the rest of the session. Every 404 that
// genuinely reports a dead model carries model-not-found language too, which
// the alternatives below already match.
const MODEL_GONE =
  /\bmodel.{0,10}not.{0,10}found\b|\bno such model\b|does not exist|has been (deprecated|decommissioned|retired|removed|sunset)|is (deprecated|decommissioned|retired|no longer available)|unknown model|invalid model|model_not_found|not a valid model/i;

export function isModelUnusableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  // Never treat a transient/busy signal as a dead model.
  if (SAME_PROVIDER_RETRY.test(message) || /overloaded|capacity|try again/i.test(message)) return false;
  return MODEL_GONE.test(message);
}

const unusableModels = new Set<string>();

/** Mark a specific model value (`provider:id`) as gone for the rest of the session. */
export function markModelUnusable(modelValue: string): void {
  if (modelValue) unusableModels.add(modelValue);
}

export function isModelUnusable(modelValue: string): boolean {
  return unusableModels.has(modelValue);
}

/** Live view of the dead-model set, for catalog filtering. */
export function unusableModelValues(): ReadonlySet<string> {
  return unusableModels;
}

/** Test-only: reset session state between cases. */
export function resetModelHealth(): void {
  unusableModels.clear();
}

// ── Provider cooldown ───────────────────────────────────────────────────────
// A rate-limited or out-of-credits provider stays bad for a while. Without a
// cooldown, a long run (e.g. a 10-section manuscript) re-tries the same dead
// provider on every section, thrashing through the whole chain each time. We
// park such a provider for a short window so subsequent calls skip it.
const providerCooldownUntil = new Map<LlmProviderId, number>();
// A provider that is merely BUSY rather than throttling us. Not a rate limit —
// nothing about our request rate caused it — but it earns the same short
// cooldown, because hammering an overloaded endpoint helps nobody. Kept local
// because only the routing layer treats these as equivalent.
const OVERLOADED = /\b(capacity|overloaded|exceeded)\b/i;

function shouldCoolDown(message: string): boolean {
  return isRateLimited(message) || OVERLOADED.test(message);
}

/** Mark a provider as cooling down based on the failure: long for billing
 *  exhaustion (the account is dead), short for a transient rate limit. */
export function cooldownProvider(provider: LlmProviderId, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const ms = isBillingDead(message)
    ? 5 * 60_000 // credits exhausted — skip for 5 minutes
    : shouldCoolDown(message)
      ? 15_000 // rate limited or busy — skip for 15 seconds (was 45s; routing stalls were ~95s)
      : 0;
  if (ms > 0) providerCooldownUntil.set(provider, Date.now() + ms);
}

export function isProviderOnCooldown(provider: LlmProviderId): boolean {
  const until = providerCooldownUntil.get(provider);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    providerCooldownUntil.delete(provider);
    return false;
  }
  return true;
}

// ── Session-permanent billing-dead providers ────────────────────────────────
// A provider that returns a hard 402 / "insufficient credits" is dead for the
// whole session — not just a 5-minute cooldown. This prevents auto-assignment
// and failover from repeatedly routing onto an unfunded provider.
const billingDeadProviders = new Set<LlmProviderId>();

export function markProviderBillingDead(provider: LlmProviderId): void {
  billingDeadProviders.add(provider);
}

export function deadProvidersThisSession(): ReadonlySet<LlmProviderId> {
  return billingDeadProviders;
}

export function clearBillingDeadProviders(): void {
  billingDeadProviders.clear();
}
