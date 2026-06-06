// Consensus Rounds — per-evidence confidence voting before boss synthesis.
// Specialists vote on each evidence item's credibility. Items below a
// configurable threshold are flagged for re-retrieval or exclusion.

import { bus } from '@core/bus/EventBus';
import type { EvidenceItem } from '@platform/index';

export interface ConsensusVote {
  agentId: string;
  evidenceHash: string;
  confidence: number; // 0–1
  reason?: string | undefined;
}

export interface ConsensusResult {
  evidenceHash: string;
  meanConfidence: number;
  voteCount: number;
  accepted: boolean;
  dissenters: string[];
}

const votes = new Map<string, ConsensusVote[]>(); // key = runId

function key(runId: string): string {
  return `consensus:${runId}`;
}

/**
 * Cast a confidence vote for an evidence item within a research run.
 */
export function castVote(
  runId: string,
  agentId: string,
  evidenceHash: string,
  confidence: number,
  reason?: string,
): ConsensusVote {
  const vote: ConsensusVote = {
    agentId,
    evidenceHash,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason,
  };
  const k = key(runId);
  const list = votes.get(k) ?? [];
  // Replace any prior vote from the same agent on the same evidence
  const filtered = list.filter(
    (v) => !(v.agentId === agentId && v.evidenceHash === evidenceHash),
  );
  filtered.push(vote);
  votes.set(k, filtered);
  bus.emit('consensus:vote', { runId, agentId, evidenceHash, confidence });
  return vote;
}

/**
 * Compute consensus results for all voted evidence in a run.
 * @param threshold Minimum mean confidence to accept (default 0.6)
 */
export function computeConsensus(
  runId: string,
  threshold = 0.6,
): ConsensusResult[] {
  const list = votes.get(key(runId)) ?? [];
  const byEvidence = new Map<string, ConsensusVote[]>();
  for (const v of list) {
    const arr = byEvidence.get(v.evidenceHash) ?? [];
    arr.push(v);
    byEvidence.set(v.evidenceHash, arr);
  }

  const results: ConsensusResult[] = [];
  for (const [evidenceHash, voteList] of byEvidence) {
    const meanConfidence =
      voteList.reduce((sum, v) => sum + v.confidence, 0) / voteList.length;
    const dissenters = voteList
      .filter((v) => v.confidence < threshold)
      .map((v) => v.agentId);
    results.push({
      evidenceHash,
      meanConfidence,
      voteCount: voteList.length,
      accepted: meanConfidence >= threshold,
      dissenters,
    });
  }

  return results.sort((a, b) => b.meanConfidence - a.meanConfidence);
}

/**
 * Return hashes of evidence items that failed consensus.
 */
export function rejectedEvidence(runId: string, threshold = 0.6): string[] {
  return computeConsensus(runId, threshold)
    .filter((r) => !r.accepted)
    .map((r) => r.evidenceHash);
}

/**
 * Summarise consensus for the boss synthesis prompt.
 */
export function summariseConsensus(runId: string, evidence: EvidenceItem[]): string {
  const results = computeConsensus(runId);
  if (results.length === 0) return '';

  const lines = results.map((r) => {
    const item = evidence.find((e) => e.provenanceHash === r.evidenceHash);
    const label = item ? `${item.source}: ${item.title}` : r.evidenceHash.slice(0, 12);
    const status = r.accepted ? 'ACCEPTED' : 'REJECTED';
    return `[${status}] ${label} — confidence ${Math.round(r.meanConfidence * 100)}% (${r.voteCount} vote${r.voteCount === 1 ? '' : 's'})`;
  });

  return `\n--- Evidence Consensus (${results.length} items) ---\n${lines.join('\n')}\n---`;
}

/**
 * Clear votes for a run.
 */
export function clearVotes(runId: string): void {
  votes.delete(key(runId));
}
