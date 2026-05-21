// Swarm orchestration — the boss-team flow:
//   1. Boss routes the message (plain chat vs. research).
//   2. For research, the boss decomposes it into specialist sub-tasks.
//   3. Specialists research their angle in parallel, each on its own model.
//   4. Boss merges their evidence and synthesizes one cited answer.

import { agentById } from '@config/agents';
import type { EvidenceItem } from '@platform/index';
import { bossChat, planResearch, synthesize } from './boss';
import { detectPaperRequest, fallbackPaperTasks } from './paper';
import { manuscriptToReadableText } from './manuscript';
import { draftManuscript } from './manuscriptWriter';
import { runSpecialist } from './specialist';
import type { SpecialistResult, SwarmOptions, SwarmResult } from './types';

function evidenceKey(record: EvidenceItem): string {
  return (
    record.url ||
    record.identifiers?.pmid ||
    record.identifiers?.doi ||
    record.provenanceHash ||
    `${record.source}-${record.title}`
  );
}

// Merge every specialist's evidence into one de-duplicated set the boss
// can cite with a single [S#] numbering.
function mergeEvidence(specialists: SpecialistResult[]): EvidenceItem[] {
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
  return merged;
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
      return `[S${index + 1}] ${record.source.toUpperCase()}${year}: ${record.title}${snippet}`;
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

export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const { question, conversation, modelFor, callbacks } = opts;
  const bossModel = modelFor('boss');
  const paperRequest = detectPaperRequest(question);

  callbacks.onBossPhase('routing');
  let plan = await planResearch(bossModel, question, conversation);
  if (paperRequest && plan.mode === 'chat') {
    plan = { mode: 'research', tasks: fallbackPaperTasks(question) };
  } else if (paperRequest && plan.mode === 'research' && plan.tasks.length < 2) {
    plan = { mode: 'research', tasks: fallbackPaperTasks(question) };
  }

  if (plan.mode === 'chat') {
    callbacks.onBossPhase('answering');
    const chat = await bossChat(bossModel, question, conversation, callbacks.onAnswerToken);
    return { kind: 'chat', answer: chat.content, evidence: [], specialists: [], modelUsed: chat.modelUsed };
  }

  callbacks.onBossPhase('delegating');
  const specialists = await Promise.all(
    plan.tasks.map((task) =>
      runSpecialist(agentById(task.agentId), modelFor(task.agentId), task.subQuery, callbacks),
    ),
  );

  const merged = mergeEvidence(specialists);
  callbacks.onBossPhase('synthesizing');

  // Full-paper requests are drafted section by section into a structured
  // manuscript — reliable across models and rendered deterministically.
  if (paperRequest) {
    const manuscript = await draftManuscript({
      question,
      bossModel,
      evidence: merged,
      specialists,
      onSection: (heading) => callbacks.onManuscriptSection?.(heading),
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
    synth = await synthesize(bossModel, question, specialists, merged, callbacks.onAnswerToken);
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
