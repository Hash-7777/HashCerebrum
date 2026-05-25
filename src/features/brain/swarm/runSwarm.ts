// Swarm orchestration — the boss-team flow:
//   1. Boss routes the message (plain chat vs. research).
//   2. For research, the boss decomposes it into specialist sub-tasks.
//   3. Specialists research their angle in parallel, each on its own model.
//   4. Boss merges their evidence and synthesizes one cited answer.

import { agentById } from '@config/agents';
import type { EvidenceItem } from '@platform/index';
import { bossChat, planResearch, synthesize } from './boss';
import { detectPaperRequest, fallbackPaperTasks, manuscriptStandardForQuestion } from './paper';
import { manuscriptToReadableText } from './manuscript';
import { runPaperPipeline } from './paperPipeline';
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
// the tail).
const SOURCE_SCORE: Record<EvidenceItem['source'], number> = {
  ctgov: 6,
  pubmed: 6,
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

// Merge every specialist's evidence into one de-duplicated set the boss
// can cite with a single [#] numbering. Records are ranked by quality
// so high-credibility evidence survives context-window truncation.
export function mergeEvidence(specialists: SpecialistResult[]): EvidenceItem[] {
  const seen = new Set<string>();
  const merged: EvidenceItem[] = [];
  for (const specialist of specialists) {
    for (const record of specialist.evidence) {
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

export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const { question, conversation, modelFor, callbacks, dataset, signal } = opts;
  const bossModel = modelFor('boss');
  const paperRequest = detectPaperRequest(question);

  callbacks.onBossPhase('routing');
  let plan = await planResearch(bossModel, question, conversation);
  if (paperRequest) {
    const requiredPaperTasks = fallbackPaperTasks(question);
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
      question,
      bossModel,
      evidence: merged,
      specialists,
      standard: manuscriptStandardForQuestion(question),
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

  let synth;
  try {
    synth = await synthesize(bossModel, question, specialists, merged, callbacks.onAnswerToken, undefined, signal);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: 'research',
      answer: sourceOnlyAnswer(question, merged, detail),
      evidence: merged,
      specialists,
      modelUsed: bossModel,
    };
  }

  return {
    kind: 'research',
    answer: synth.content,
    evidence: merged,
    specialists,
    modelUsed: synth.modelUsed,
  };
}
