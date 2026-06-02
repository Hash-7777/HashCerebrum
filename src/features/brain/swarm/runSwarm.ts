// Swarm orchestration — the boss-team flow:
//   1. Boss routes the message (plain chat vs. research).
//   2. For research, the boss decomposes it into specialist sub-tasks.
//   3. Specialists research their angle in parallel, each on its own model.
//   4. Boss merges their evidence and synthesizes one cited answer.

import { agentById } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import type { EvidenceItem } from '@platform/index';
import {
  appraisePriorWork,
  bossChat,
  contextualizeQuestion,
  planResearch,
  synthesize,
  synthesizeInteractionReport,
} from './boss';
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

// Filler words ignored when scoring a record's relevance to the question.
// Includes request/deliverable instruction words ("make a full research paper
// about …") and common misspellings, so they never become "concepts" — they
// were leaking into the evidence-gap note as "no records cover: make, full,
// reaserch, …".
const RELEVANCE_FILLER = new Set([
  'about', 'after', 'against', 'among', 'and', 'any', 'are', 'between', 'both', 'compare', 'comparison',
  'does', 'effect', 'effects', 'evidence', 'for', 'from', 'have', 'high', 'how', 'into', 'its', 'low',
  'more', 'most', 'only', 'over', 'paper', 'patient', 'patients', 'research', 'review', 'risk', 'safety',
  'than', 'that', 'their', 'them', 'these', 'this', 'those', 'using', 'versus', 'what', 'which', 'with',
  'within', 'your',
  // request / deliverable instruction words + typos (not subject concepts)
  'make', 'write', 'draft', 'create', 'generate', 'produce', 'compose', 'prepare', 'give', 'want',
  'need', 'please', 'full', 'complete', 'comprehensive', 'detailed', 'thorough', 'professional',
  'publishable', 'proper', 'reaserch', 'reasearch', 'reserch', 'manuscript', 'article', 'report',
  'document', 'regarding', 'concerning', 'statistics', 'statistical', 'stats', 'numbers', 'numeric',
  'data', 'analysis',
]);

// A few common medical concept synonyms so a record that uses "kidney" still
// matches a question phrased with "renal" (avoids dropping relevant papers).
const MEDICAL_SYNONYMS: Record<string, string[]> = {
  renal: ['kidney'],
  kidney: ['renal'],
  cardiac: ['heart', 'cardiovascular'],
  heart: ['cardiac', 'cardiovascular'],
  cardiovascular: ['cardiac', 'heart'],
  hepatic: ['liver'],
  liver: ['hepatic'],
  pulmonary: ['lung'],
  lung: ['pulmonary'],
  gastric: ['stomach', 'gastrointestinal'],
  gastrointestinal: ['gastric', 'gi'],
};

// Build concept groups from the question: each significant term plus its known
// synonyms forms ONE group, so a record is credited once per concept it covers
// rather than once per synonym (the old flat list double-counted "renal" and
// "kidney"). Records covering MORE distinct concepts — e.g. both "warfarin" and
// "NSAIDs" — then outrank single-concept matches.
export function conceptGroups(question: string): string[][] {
  const terms = [
    ...new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !RELEVANCE_FILLER.has(w)),
    ),
  ];
  return terms.map((term) => [term, ...(MEDICAL_SYNONYMS[term] ?? [])]);
}

// How many distinct question concepts a record's title/snippet actually covers.
export function conceptCoverage(record: EvidenceItem, groups: string[][]): number {
  const hay = `${record.title} ${record.snippet ?? ''}`.toLowerCase();
  let n = 0;
  for (const group of groups) if (group.some((syn) => hay.includes(syn))) n += 1;
  return n;
}

// Assess whether the retrieved evidence actually covers the question's
// concepts. Returns the concepts that NO retrieved record addresses — the
// honest gaps. These are surfaced to the user and named for the drafting model
// so the output states the gap plainly instead of implying depth that the
// sources do not support. Only a PARTIAL gap is flagged (some concepts covered,
// some not): that is the dangerous case where a paper looks complete while
// silently missing a core entity. A total miss is left to the low-evidence floor.
export function assessEvidenceSufficiency(
  question: string,
  evidence: EvidenceItem[],
): { uncovered: string[]; note: string | null } {
  const groups = conceptGroups(question);
  if (groups.length === 0) return { uncovered: [], note: null };
  const uncovered = groups
    .filter((group) => {
      const present = evidence.some((record) => {
        const hay = `${record.title} ${record.snippet ?? ''}`.toLowerCase();
        return group.some((syn) => hay.includes(syn));
      });
      return !present;
    })
    .map((group) => group[0]!);
  if (uncovered.length === 0 || uncovered.length === groups.length) return { uncovered, note: null };
  const note =
    `The retrieved records contain NO direct evidence for the following requested concept(s): ` +
    `${uncovered.join(', ')}. State this gap explicitly and early, attribute it to the absence of ` +
    `retrieved sources, and do not imply that evidence exists for these concepts.`;
  return { uncovered, note };
}

// Re-rank merged evidence by how many of the question's CONCEPTS each record
// covers (conjunctive relevance), so multi-concept records lead and
// single-concept noise sinks or drops. When the question spans ≥3 concepts a
// record must cover at least two to count as on-topic — a record matching only
// "warfarin" on a warfarin + NSAID + digoxin question is off-target noise. The
// bar loosens automatically (≥2 → ≥1 → keep all) so a genuinely sparse topic is
// never gutted. Equal coverage preserves the prior quality/recency order.
export function rankEvidenceByRelevance(question: string, evidence: EvidenceItem[]): EvidenceItem[] {
  const groups = conceptGroups(question);
  if (groups.length === 0) return evidence;
  const scored = evidence
    .map((record, index) => ({ record, index, m: conceptCoverage(record, groups) }))
    .sort((a, b) => b.m - a.m || a.index - b.index);
  const minConcepts = groups.length >= 3 ? 2 : 1;
  const strong = scored.filter((s) => s.m >= minConcepts);
  const loose = scored.filter((s) => s.m > 0);
  const kept = strong.length >= 6 ? strong : loose.length >= 6 ? loose : scored;
  return kept.map((s) => s.record);
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
  const mini = opts.mini ?? false;
  const drugFocus = opts.drugFocus ?? false;
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

  // Drug-Interactions focus: a single specialist gathers interaction evidence
  // from trusted sources and the boss writes a focused interaction report —
  // not a manuscript and not the full research team. Findings still flow into
  // the shared memory through the normal save path, so Brain benefits later.
  if (drugFocus) {
    callbacks.onBossPhase('delegating');
    const specialist = await runSpecialist(
      agentById('drug_interactions'),
      modelFor('drug_interactions'),
      researchQuestion,
      callbacks,
    );
    const merged = rankEvidenceByRelevance(researchQuestion, mergeEvidence([specialist]));
    const citable = merged.filter((record) => !CONTEXT_ONLY_SOURCES.has(record.source));
    callbacks.onBossPhase('synthesizing');
    const report = await synthesizeInteractionReport(
      bossModel,
      researchQuestion,
      [specialist],
      citable,
      callbacks.onAnswerToken,
      signal,
    );
    return {
      kind: 'research',
      answer: report.content,
      evidence: citable,
      specialists: [specialist],
      modelUsed: report.modelUsed,
    };
  }

  callbacks.onBossPhase('routing');
  let plan = await planResearch(bossModel, researchQuestion, conversation);
  if (paperRequest) {
    const requiredPaperTasks = fallbackPaperTasks(researchQuestion);
    plan = {
      mode: 'research',
      tasks: plan.mode === 'research' ? mergePaperTasks(plan.tasks, requiredPaperTasks) : requiredPaperTasks,
    };
  }

  // Brain Mini: cap the swarm to a couple of specialists so a low-quota or
  // small local model isn't asked to run six source agents in parallel.
  if (mini && plan.mode === 'research') {
    plan = { mode: 'research', tasks: plan.tasks.slice(0, 2) };
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

  // Merge, de-duplicate, quality-rank, then re-rank by topical relevance to the
  // (context-resolved) question so off-topic records sink or drop out before
  // they can be cited.
  const merged = rankEvidenceByRelevance(researchQuestion, mergeEvidence(specialists));

  // Honesty gate: name any requested concept with NO direct supporting record,
  // so the answer states the gap plainly instead of implying depth. Surfaced in
  // the trace and passed to the drafting model.
  const gap = assessEvidenceSufficiency(researchQuestion, merged);
  if (gap.note) {
    bus.emit('agent:activity', {
      agentId: 'boss',
      phase: 'tool_call',
      detail: `Direct evidence gap — no records cover: ${gap.uncovered.join(', ')}`,
    });
  }
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
      ...(gap.note ? { evidenceGap: gap.note } : {}),
      mini,
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
    synth = await synthesize(bossModel, researchQuestion, specialists, citableEvidence, callbacks.onAnswerToken, undefined, signal, gap.note ?? undefined, mini);
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
