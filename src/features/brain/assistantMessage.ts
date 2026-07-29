// Turning a finished swarm run into the assistant message the transcript shows.
//
// This assembly was written out twice inside BrainMode — once where a streamed
// answer finishes and once where a drafted paper does — as two identical object
// spreads. Identical is the problem: every field the swarm learns to return has
// to be remembered into both places, and `associations` was already added to
// "both build sites" by hand once. The second site is exactly the one a future
// field will be forgotten in, and the failure is silent, because a missing
// spread produces a message that renders perfectly with something absent.
//
// Optional fields are spread conditionally rather than assigned as undefined:
// the project runs `exactOptionalPropertyTypes`, so `{ manuscript: undefined }`
// is not the same type as `{}`.

import type { ChatMessage, TurnTraceEntry } from '@core/store/chatHistoryStore';
import type { SwarmResult } from './swarm/types';
import { labelForModel } from './researchPipeline';

/** How many retrieved records a message carries as citations. */
const MAX_CITATIONS = 60;

/**
 * Fold a completed run into the pending assistant message.
 *
 * `content` is passed separately because the two callers arrive with different
 * text: the streamed path has already accumulated its own, while the drafted
 * path falls back to a placeholder when the run returns nothing.
 */
export function applySwarmResult(
  message: ChatMessage,
  result: SwarmResult,
  content: string,
  trace: TurnTraceEntry[],
): ChatMessage {
  const isResearch = result.kind === 'research';
  return {
    ...message,
    content,
    modelLabel: labelForModel(result.modelUsed),
    isStreaming: false,
    trace,
    ...(isResearch ? { citations: result.evidence.slice(0, MAX_CITATIONS) } : {}),
    ...(result.manuscript ? { manuscript: result.manuscript } : {}),
    ...(result.associations ? { associations: result.associations } : {}),
    // A conversational answer is one the swarm produced without searching, and
    // the transcript badges it so a reader can tell the two apart. Without this
    // the only difference between a researched answer and an improvised one is
    // the absence of citation badges, which nobody notices.
    grounding: isResearch ? 'evidence' : 'conversational',
  };
}
