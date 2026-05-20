// Swarm orchestration — the boss-team flow:
//   1. Boss routes the message (plain chat vs. research).
//   2. For research, the boss decomposes it into specialist sub-tasks.
//   3. Specialists research their angle in parallel, each on its own model.
//   4. Boss merges their evidence and synthesizes one cited answer.

import { agentById } from '@config/agents';
import type { EvidenceItem } from '@platform/index';
import { bossChat, planResearch, synthesize } from './boss';
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

export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const { question, conversation, modelFor, callbacks } = opts;
  const bossModel = modelFor('boss');

  callbacks.onBossPhase('routing');
  const plan = await planResearch(bossModel, question, conversation);

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
  const synth = await synthesize(bossModel, question, specialists, merged, callbacks.onAnswerToken);

  return {
    kind: 'research',
    answer: synth.content,
    evidence: merged,
    specialists,
    modelUsed: synth.modelUsed,
  };
}
