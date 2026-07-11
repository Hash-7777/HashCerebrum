// Intent classification for the mega-mind Brain. A single research request is
// routed to the right internal pipeline by DETERMINISTIC heuristics first — a
// normal chat never spins up the swarm, a drug or gene question never triggers the
// full-paper machinery unless asked. An explicit slash command overrides the
// heuristic. A model tiebreak is only worth spending on genuinely ambiguous input
// (see `ambiguous`), which the caller may resolve with one lightweight call.
//
// NOTE: identity / safety / greeting / off-topic gating stays UPSTREAM in runSwarm.
// This module assumes the request is research-bound and only picks WHICH research
// intent it is.

import { drugCandidates } from './boss';
import { hasGeneSignal, hasDiseaseSignal } from './genetics/geneQueryReadiness';
import type { SlashEffort, SlashIntent } from '../composer/slashCommands';

export type ResearchIntent = 'lookup' | 'rag' | 'evidence_review' | 'paper' | 'drug_interactions' | 'genetics';
export type Effort = 'mini' | 'standard' | 'deep';

export interface ResolvedIntent {
  intent: ResearchIntent;
  effort: Effort;
  /** True when a slash command forced the intent (no heuristic / no tiebreak). */
  forced: boolean;
  /** True when the heuristic was not confident — the caller MAY run a model tiebreak. */
  ambiguous: boolean;
}

// A request for a publishable artifact — not merely a cited answer. "Publication-ready",
// "publishable" and "journal article" ask for the manuscript pipeline (PRISMA diagram,
// forest plot, structured sections) just as plainly as the word "paper" does; without
// them a "publication-ready evidence review" fell through to a plain cited answer and
// the requested figures were never generated. A bare "evidence review" stays a review.
const PAPER_CUE =
  /\b(full|complete|comprehensive|publishable)?\s*(research|scientific)?\s*(paper|manuscript)\b|\bsystematic review\b|\bliterature review\b|\bpublication[-\s]?ready\b|\bsubmission[-\s]?ready\b|\bpublishable\b|\bjournal article\b|\bwrite\b[^.?!]*\b(paper|manuscript|review)\b|\bdraft\b[^.?!]*\b(paper|manuscript)\b/i;
const INTERACTION_CUE =
  /\binteract(?:ion|ions|s|ing)?\b|\bcombin(?:e|ed|ing|ation)\b|\btogether\b|\bcontraindicat|\bco-?administ|\bconcomitant\b|\bdrug[-\s]drug\b/i;

/** Does the text carry a drug-interaction cue? Used to detect an interaction
 *  sub-request riding along with a paper request, so the paper folds in the
 *  interaction literature instead of declaring no data. */
export function hasInteractionCue(text: string): boolean {
  return INTERACTION_CUE.test(text);
}
// A generic question ABOUT interactions ("what are common drug interactions…") is
// a lookup, not a specific grade request. Only treat it as drug_interactions when
// the message actually names drugs joined in a list.
const ABOUT_QUESTION = /^\s*(?:what|which|how|why|are there|is there|tell me|explain|list|describe)\b/i;
const DRUG_LIST_CUE = /,|;|\/|\band\b|\bwith\b|\bversus\b|\bvs\b|\bplus\b|&/i;
const GENETICS_CUE = /\bassociat|\bcorrelat|\bgenotype|\bpolymorphism|\ballele\b|\bvariant\b|\brisk allele\b|\bheritab/i;
const RAG_CUE =
  /\bfrom\s+(?:my|the)\s+(?:memory|library|notes|saved)\b|\bwhat\s+do\s+i\s+(?:know|have)\b|\balready\s+(?:found|saved|know)\b|\brecall\b|\bin\s+my\s+(?:research|library|memory)\b/i;
const LOOKUP_CUE = /^(?:what\s+is|what\s+are|define|who\s+|when\s+|where\s+|which\s+|how\s+many|list\s+)/i;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Deterministic research-intent classifier — no model call. */
export function classifyIntentHeuristic(text: string): { intent: ResearchIntent; ambiguous: boolean } {
  const t = text.trim();
  if (!t) return { intent: 'evidence_review', ambiguous: true };

  // Explicitly asking for a manuscript wins over topic detection ("write a paper on
  // BRCA1 and breast cancer" is a paper, not a genetics report).
  if (PAPER_CUE.test(t)) return { intent: 'paper', ambiguous: false };

  // Drug interactions: an interaction cue AND at least two candidate drugs. A
  // generic "what are drug interactions" question only counts when it actually
  // names drugs joined in a list — otherwise it's a lookup, not a grade request.
  if (INTERACTION_CUE.test(t) && drugCandidates(t).length >= 2 && (!ABOUT_QUESTION.test(t) || DRUG_LIST_CUE.test(t))) {
    return { intent: 'drug_interactions', ambiguous: false };
  }

  // Genetics: a gene symbol / rsID, plus a disease or a genetics cue.
  if (hasGeneSignal(t) && (hasDiseaseSignal(t) || GENETICS_CUE.test(t))) {
    return { intent: 'genetics', ambiguous: false };
  }

  if (RAG_CUE.test(t)) return { intent: 'rag', ambiguous: false };

  // A short, direct factual question → a quick cited lookup rather than a review.
  if (LOOKUP_CUE.test(t) && wordCount(t) <= 12) return { intent: 'lookup', ambiguous: false };

  // Default: a cited evidence review. Flag very short / cue-less input as ambiguous
  // so the caller can optionally spend one model call to disambiguate.
  return { intent: 'evidence_review', ambiguous: wordCount(t) <= 4 };
}

const FORCED_EFFORT: Record<SlashEffort, Effort> = { mini: 'mini', deep: 'deep' };

/** Combine a slash-command override with the heuristic into a final decision. */
export function resolveIntent(
  text: string,
  opts: { forcedIntent?: SlashIntent; forcedEffort?: SlashEffort } = {},
): ResolvedIntent {
  const effort: Effort = opts.forcedEffort ? FORCED_EFFORT[opts.forcedEffort] : 'standard';
  if (opts.forcedIntent) {
    return { intent: opts.forcedIntent, effort, forced: true, ambiguous: false };
  }
  const { intent, ambiguous } = classifyIntentHeuristic(text);
  return { intent, effort, forced: false, ambiguous };
}
