// Swarm orchestration — the boss-team flow:
//   1. Boss routes the message (plain chat vs. research).
//   2. For research, the boss decomposes it into specialist sub-tasks.
//   3. Specialists research their angle in parallel, each on its own model.
//   4. Boss merges their evidence and synthesizes one cited answer.

import { agentById } from '@config/agents';
import type { EvidenceItem } from '@platform/index';
import { appraisePriorWork, bossChat, contextualizeQuestion, planResearch, synthesize } from './boss';
import {
  detectPaperRequest,
  fallbackPaperTasks,
  isMetaOrAppQuestion,
  isPriorWorkReviewRequest,
  manuscriptStandardForQuestion,
} from './paper';
import type { LlmMessage } from '@core/llm/types';
import { manuscriptToReadableText } from './manuscript';
import { CONTEXT_ONLY_SOURCES, runPaperPipeline } from './paperPipeline';
import { runSpecialist } from './specialist';
import type { SpecialistResult, SpecialistTask, SwarmOptions, SwarmResult } from './types';

export function evidenceKey(record: EvidenceItem): string {
  return (
    record.url ||
    record.identifiers?.pmid ||
    record.identifiers?.doi ||
    record.provenanceHash ||
    `${record.source}-${record.title}`
  );
}

// Rank sources by clinical credibility so the most trustworthy records
// reach the synthesis model first (context-window limits may truncate
// the tail). PubMed is favored: as the primary peer-reviewed biomedical
// index it carries the highest base weight so its records lead the merged
// set and are the last to be dropped under truncation.
const SOURCE_SCORE: Record<EvidenceItem['source'], number> = {
  pubmed: 12,
  ctgov: 6,
  europepmc: 5,
  openalex: 4,
  openfda: 3,
  rxnorm: 2,
};

export function evidenceScore(record: EvidenceItem): number {
  let score = SOURCE_SCORE[record.source] ?? 1;
  const year = typeof record.year === 'number' ? record.year : Number.parseInt(String(record.year ?? ''), 10);
  if (Number.isFinite(year)) {
    score += Math.max(0, Math.min(10, (year - 2010) / 2));
  }
  // Peer-reviewed indexed records with a PMID or DOI rank above regulatory
  // entries that lack a journal identifier.
  if (record.identifiers?.pmid) score += 2;
  else if (record.identifiers?.doi) score += 1;
  if (record.url) score += 1;
  if (record.snippet && record.snippet.length > 20) score += 1;
  return score;
}

// Conference-proceeding and abstract-collection records (poster books, oral
// presentation lists, society-meeting abstract supplements). They are not
// individual peer-reviewed studies and must never be cited as primary
// evidence, so they are dropped from the merged set entirely.
const PROCEEDING_TITLE_RX =
  /(\be-?posters?\b|\bposter (presentation|collection|session)|book of posters|\boral presentations?\b|moderated posters|abstracts? (from|of) the|proceedings of the|\bannual meeting\b|congress of the|\bueg week\b|\blives\s+\d{4}\b)/i;

export function isNonCitableProceeding(record: EvidenceItem): boolean {
  return PROCEEDING_TITLE_RX.test(record.title ?? '');
}

// Merge every specialist's evidence into one de-duplicated set the boss
// can cite with a single [#] numbering. Records are ranked by quality
// so high-credibility evidence survives context-window truncation.
// Conference-proceeding noise is filtered out before ranking.
export function mergeEvidence(specialists: SpecialistResult[]): EvidenceItem[] {
  const seen = new Set<string>();
  const merged: EvidenceItem[] = [];
  for (const specialist of specialists) {
    for (const record of specialist.evidence) {
      if (isNonCitableProceeding(record)) continue;
      const key = evidenceKey(record);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(record);
    }
  }
  return merged.sort((a, b) => evidenceScore(b) - evidenceScore(a));
}

function sourceOnlyAnswer(question: string, evidence: EvidenceItem[], reason: string): string {
  if (evidence.length === 0) {
    return `No source records were retrieved for "${question}". Boss synthesis also failed: ${reason}`;
  }
  const snapshot = evidence
    .slice(0, 10)
    .map((record, index) => {
      const year = record.year ? ` (${record.year})` : '';
      const snippet = record.snippet ? ` — ${record.snippet.replace(/\s+/g, ' ').slice(0, 220)}` : '';
      return `[${index + 1}] ${record.source.toUpperCase()}${year}: ${record.title}${snippet}`;
    })
    .join('\n');
  return [
    `Source agents retrieved ${evidence.length} record(s) for "${question}", but the boss could not draft the synthesis: ${reason}`,
    '',
    'Evidence snapshot:',
    snapshot,
    '',
    'Use this as source triage, not medical advice.',
  ].join('\n');
}

function mergePaperTasks(planned: SpecialistTask[], required: SpecialistTask[]): SpecialistTask[] {
  const merged = [...required];
  const seenAgents = new Set(required.map((task) => task.agentId));
  for (const task of planned) {
    if (seenAgents.has(task.agentId)) continue;
    seenAgents.add(task.agentId);
    merged.push(task);
  }
  return merged;
}

// The most recent assistant turn with enough body to be the "paper" or
// "answer" a follow-up review request is referring to.
function mostRecentSubstantialAnswer(conversation: LlmMessage[]): string | null {
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    const msg = conversation[i];
    if (msg?.role === 'assistant' && msg.content.trim().length >= 400) return msg.content;
  }
  return null;
}

export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const { question, conversation, modelFor, callbacks, dataset, signal } = opts;
  const bossModel = modelFor('boss');

  // A follow-up that asks the team to appraise its own previous output ("rate
  // that paper", "review this draft") is answered by reviewing that document
  // directly — never by launching a fresh research swarm, which is what caused
  // the boss to rate unrelated retrieved literature instead of the user's paper.
  if (isPriorWorkReviewRequest(question)) {
    const priorWork = mostRecentSubstantialAnswer(conversation);
    if (priorWork) {
      callbacks.onBossPhase('answering');
      const appraisal = await appraisePriorWork(bossModel, priorWork, question, callbacks.onAnswerToken, signal);
      return { kind: 'chat', answer: appraisal.content, evidence: [], specialists: [], modelUsed: appraisal.modelUsed };
    }
  }

  // Meta / app-introspection / prompt-injection questions are not biomedical
  // research — answer them in plain chat (the boss explains or declines)
  // instead of launching the research swarm, which turned them into refusals
  // rendered as "Research result · N references" documents.
  if (isMetaOrAppQuestion(question)) {
    callbacks.onBossPhase('answering');
    const chat = await bossChat(bossModel, question, conversation, callbacks.onAnswerToken, signal);
    return { kind: 'chat', answer: chat.content, evidence: [], specialists: [], modelUsed: chat.modelUsed };
  }

  // Resolve a context-dependent follow-up ("so which is safer?") into a
  // self-contained query so the specialists search the real topic, not the
  // literal pronoun string. The paper-vs-answer decision stays on the user's
  // original phrasing.
  const paperRequest = detectPaperRequest(question);
  const researchQuestion = await contextualizeQuestion(bossModel, question, conversation);

  callbacks.onBossPhase('routing');
  let plan = await planResearch(bossModel, researchQuestion, conversation);
  if (paperRequest) {
    const requiredPaperTasks = fallbackPaperTasks(researchQuestion);
    plan = {
      mode: 'research',
      tasks: plan.mode === 'research' ? mergePaperTasks(plan.tasks, requiredPaperTasks) : requiredPaperTasks,
    };
  }

  if (plan.mode === 'chat') {
    callbacks.onBossPhase('answering');
    const chat = await bossChat(bossModel, question, conversation, callbacks.onAnswerToken, signal);
    return { kind: 'chat', answer: chat.content, evidence: [], specialists: [], modelUsed: chat.modelUsed };
  }

  callbacks.onBossPhase('delegating');
  if (paperRequest) callbacks.onManuscriptSection?.('Searching');
  const specialists = await Promise.all(
    plan.tasks.map((task) =>
      runSpecialist(agentById(task.agentId), modelFor(task.agentId), task.subQuery, callbacks),
    ),
  );

  const merged = mergeEvidence(specialists);
  callbacks.onBossPhase('synthesizing');

  // Full-paper requests are drafted section by section into a structured
  // manuscript from a source-backed evidence extraction and claim ledger.
  if (paperRequest) {
    const manuscript = await runPaperPipeline({
      question: researchQuestion,
      bossModel,
      evidence: merged,
      specialists,
      standard: manuscriptStandardForQuestion(researchQuestion),
      ...(dataset ? { dataset } : {}),
      onStage: (stage) => callbacks.onManuscriptSection?.(stage),
    });
    return {
      kind: 'research',
      answer: manuscriptToReadableText(manuscript),
      evidence: merged,
      specialists,
      manuscript,
      modelUsed: bossModel,
    };
  }

  // For a freeform research answer, cite only peer-reviewed literature: drop
  // drug-label / drug-terminology sources (OpenFDA, RxNorm) from the citable
  // set so they never become numbered references. Their content still reaches
  // the boss through the specialist findings, just not as a citation. The
  // structured manuscript pipeline above keeps them as documented context.
  const citableEvidence = merged.filter((record) => !CONTEXT_ONLY_SOURCES.has(record.source));

  let synth;
  try {
    synth = await synthesize(bossModel, researchQuestion, specialists, citableEvidence, callbacks.onAnswerToken, undefined, signal);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: 'research',
      answer: sourceOnlyAnswer(researchQuestion, citableEvidence, detail),
      evidence: citableEvidence,
      specialists,
      modelUsed: bossModel,
    };
  }

  return {
    kind: 'research',
    answer: synth.content,
    evidence: citableEvidence,
    specialists,
    modelUsed: synth.modelUsed,
  };
}
