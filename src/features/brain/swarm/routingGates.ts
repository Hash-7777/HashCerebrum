// The routing gate chain — the ordered set of checks every message passes
// through before any research work begins.
//
// WHY THIS IS A LIST AND NOT AN IF-LADDER
//
// The order here is load-bearing, and it is a security property rather than a
// stylistic one. Two rules it encodes:
//
//   * The injection and system-prompt gates must sit ABOVE every gate that
//     hands the message to a model. A detector that routes a flagged message
//     onto a softer path is a bypass, not a guard: the chat path has no
//     retrieval, no drug or gene lexicon, no citation renumbering and no
//     honesty pass, yet its answer renders with exactly the same authority.
//     Being noticed must cost an attacker something, so those two gates answer
//     with fixed text and never reach a model at all.
//
//   * The deterministic safety replies (identity, self-harm, harmful request)
//     sit above everything, so no routing decision can turn them into a
//     research run or a model-improvised answer.
//
// Spelled as sixteen sequential early returns, that order was invisible: it
// spanned roughly two hundred lines, and nothing stopped a new check landing in
// the wrong place. As a declared list the whole chain reads at a glance, and
// `routingGates.test.ts` asserts the order by id — so moving a gate above the
// injection check fails the suite instead of shipping.
//
// Adding a gate: append an entry, put it in the right place in the list, and
// extend the order assertion in the test. If the new gate answers with a model,
// it belongs below `prompt_injection` and `system_prompt_request`.

import type { LlmMessage } from '@core/llm/types';
import { appraisePriorWork, bossChat, identityAnswer, isIdentityQuestion } from './boss';
import {
  HARMFUL_REQUEST_REFUSAL,
  isCodingRequest,
  isHarmfulRequest,
  isJailbreakAttempt,
  isMetaOrAppQuestion,
  isOffTopicQuestion,
  isPriorWorkReviewRequest,
  isPromptInjection,
  isSelfHarmQuery,
  isSmallTalk,
  isSystemPromptRequest,
  PROMPT_INJECTION_REFUSAL,
  SELF_HARM_MESSAGE,
  SYSTEM_PROMPT_REFUSAL,
} from './paper';
import type { SwarmCallbacks, SwarmResult } from './types';

export type RoutingGateId =
  | 'identity'
  | 'self_harm'
  | 'harmful_request'
  | 'prior_work_review'
  | 'prompt_injection'
  | 'system_prompt_request'
  | 'meta_or_app'
  | 'jailbreak'
  | 'off_topic'
  | 'coding_request'
  | 'small_talk';

export interface GateContext {
  question: string;
  bossModel: string;
  callbacks: SwarmCallbacks;
  signal: AbortSignal | undefined;
  /**
   * The assembled cross-turn context, built on demand. Only the gates that
   * answer through a model need it, and the deterministic gates above them
   * return before it is ever requested — so a refused message costs no recall
   * work and no model call.
   */
  bossContext: () => Promise<LlmMessage[]>;
  /**
   * The most recent substantial assistant answer, or null when there is none.
   * Lazy for the same reason: only the appraisal gate reads it.
   */
  priorWork: () => string | null;
  /**
   * Short things the person said earlier that fell outside the context window
   * (see earlierUserLines). Optional so a caller with no history passes nothing.
   */
  earlierUserLines?: () => Promise<string[]>;
}

export interface RoutingGate {
  id: RoutingGateId;
  /** Does this gate claim the message? */
  claims: (ctx: GateContext) => boolean;
  /** Produce the reply. Only called when `claims` returned true. */
  handle: (ctx: GateContext) => Promise<SwarmResult>;
}

/**
 * A gate that answers with fixed text. No model call, no context assembly —
 * which is the point for the refusals: detection must not become a way to spend
 * the user's quota, and a deterministic reply cannot be argued with.
 */
function deterministic(
  id: RoutingGateId,
  claims: (question: string) => boolean,
  reply: string | ((ctx: GateContext) => string),
): RoutingGate {
  return {
    id,
    claims: (ctx) => claims(ctx.question),
    handle: async (ctx) => {
      const message = typeof reply === 'function' ? reply(ctx) : reply;
      ctx.callbacks.onBossPhase('answering');
      ctx.callbacks.onAnswerToken(message);
      return {
        kind: 'chat',
        answer: message,
        evidence: [],
        specialists: [],
        modelUsed: ctx.bossModel,
      };
    },
  };
}

/**
 * A gate that hands the message to the boss model in plain chat, where the
 * hardened system prompt handles it. Everything using this shape sits below the
 * two refusal gates by construction.
 */
function modelAnswered(id: RoutingGateId, claims: (question: string) => boolean): RoutingGate {
  return {
    id,
    claims: (ctx) => claims(ctx.question),
    handle: async (ctx) => {
      ctx.callbacks.onBossPhase('answering');
      const chat = await bossChat(
        ctx.bossModel,
        ctx.question,
        await ctx.bossContext(),
        ctx.callbacks.onAnswerToken,
        ctx.signal,
        (await ctx.earlierUserLines?.()) ?? [],
      );
      return {
        kind: 'chat',
        answer: chat.content,
        evidence: [],
        specialists: [],
        modelUsed: chat.modelUsed,
      };
    },
  };
}

export const ROUTING_GATES: readonly RoutingGate[] = [
  // Identity is answered with fixed text built from the app's own record of the
  // model it calls, never from the model's description of itself.
  deterministic('identity', isIdentityQuestion, (ctx) => identityAnswer(ctx.bossModel)),

  // Safety first, before any routing at all.
  deterministic('self_harm', isSelfHarmQuery, SELF_HARM_MESSAGE),
  deterministic('harmful_request', isHarmfulRequest, HARMFUL_REQUEST_REFUSAL),

  // "Rate that paper" reviews the document already on screen rather than
  // launching a fresh research swarm, which is what once had the boss appraising
  // unrelated retrieved literature instead of the user's own draft.
  {
    id: 'prior_work_review',
    claims: (ctx) => isPriorWorkReviewRequest(ctx.question) && ctx.priorWork() !== null,
    handle: async (ctx) => {
      ctx.callbacks.onBossPhase('answering');
      const appraisal = await appraisePriorWork(
        ctx.bossModel,
        ctx.priorWork()!,
        ctx.question,
        ctx.callbacks.onAnswerToken,
        ctx.signal,
      );
      return {
        kind: 'chat',
        answer: appraisal.content,
        evidence: [],
        specialists: [],
        modelUsed: appraisal.modelUsed,
      };
    },
  },

  // ── Everything below this line may reach a model. The two refusals come
  //    first so that being detected is never the cheaper path. ──────────────
  deterministic('prompt_injection', isPromptInjection, PROMPT_INJECTION_REFUSAL),
  deterministic('system_prompt_request', isSystemPromptRequest, SYSTEM_PROMPT_REFUSAL),

  // Not biomedical research: answered in chat rather than dressed up as a
  // "Research result · N references" document.
  modelAnswered('meta_or_app', isMetaOrAppQuestion),
  modelAnswered('jailbreak', isJailbreakAttempt),
  modelAnswered('off_topic', isOffTopicQuestion),
  modelAnswered('coding_request', isCodingRequest),
  // Deterministic detection, model-written reply: a bare greeting must not
  // become a literature search even when the planner is rate-limited, whose
  // safe default is "research".
  modelAnswered('small_talk', isSmallTalk),
];

/**
 * Walk the chain in order. Returns the first gate's reply, or null when no gate
 * claims the message and the research path should run.
 */
export async function runRoutingGates(ctx: GateContext): Promise<SwarmResult | null> {
  for (const gate of ROUTING_GATES) {
    if (!gate.claims(ctx)) continue;
    return await gate.handle(ctx);
  }
  return null;
}
