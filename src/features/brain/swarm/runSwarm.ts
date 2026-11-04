// Swarm orchestration — the boss-team flow:
//   1. Boss routes the message (plain chat vs. research).
//   2. For research, the boss decomposes it into specialist sub-tasks.
//   3. Specialists research their angle in parallel, each on its own model.
//   4. Boss merges their evidence and synthesizes one cited answer.

import { agentById } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import { setMemoryScope, clearMemoryScope } from '@core/tools/memoryScope';
import { retrieve, smartRetrieve, useRagStore, parentWindowText } from '@core/rag';
import { enrichEvidenceWithFullText } from '@core/rag/fulltext/enrich';
import { extractPico, picoSummary, isPicoUseful } from './pico';
import { createEpisode } from '@core/rag/agentic/episodicMemory';
import { useLearningStore } from '@core/rag/agentic/learningStore';
import { studyTopGaps } from '@core/rag/agentic/studyEngine';
import { useProjectStore } from '@core/store/projectStore';
import { useMemorySettingsStore } from '@core/store/memorySettingsStore';
import { platform, type EvidenceItem } from '@platform/index';
import {
  bossChat,
  contextualizeQuestion,
  drugCandidates,
  planResearch,
  synthesize,
  synthesizeGeneCorrelationReport,
  synthesizeInteractionReport,
  unverifiedDrugMessage,
  unverifiedDrugNames,
} from './boss';
import { geneAssociations, type GeneAssociation } from './genetics/associationConfidence';
import { genesForQuestion } from './genetics/variantGenes';
import {
  assessGeneQueryReadiness,
  clarificationMessage,
  diseaseTerms as geneDiseaseTerms,
  extractGeneSymbols,
  extractRsIds,
  extractUnrecognizedGeneTokens,
  unrecognizedGeneMessage,
} from './genetics/geneQueryReadiness';
import {
  detectPaperRequest,
  fallbackPaperTasks,
  manuscriptStandardForQuestion,
} from './paper';
import type { LlmMessage } from '@core/llm/types';
import { isProviderOnCooldown } from '@core/llm/failover';
import { parseModelRef } from '@core/llm/modelCatalog';
import { manuscriptToReadableText } from './manuscript';
import { normalizeMedicalSpelling } from './queryNormalize';
import { preparePaperLedger, compileManuscriptFromLedger } from './paperPipeline';
import { CONTEXT_ONLY_SOURCES } from './evidenceExtraction';
import { runRoutingGates } from './routingGates';
import { runSpecialist } from './specialist';
import { backfillLandmarkTrials } from './trialBackfill';
import { backfillDrugInteractions } from './interactionBackfill';
import { backfillNamedEntityEvidence } from './entityBackfill';
import { expandDrugQuery } from './drugAliases';
import { budgetConversation } from './conversationBudget';
import { assembleContext } from '../context/assembleContext';
import { historyTokenBudget } from '../context/tokenBudget';
import type { SpecialistResult, SpecialistTask, SwarmCallbacks, SwarmOptions, SwarmResult } from './types';
import {
  assessEvidenceSufficiency,
  rankEvidenceByRelevance,
  mergeEvidence,
} from './evidenceRanking';

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

// Retrieve passages from the user's imported PDF library that match the
// question and turn them into citable EvidenceItems (source 'library'), so the
// Brain can cite the specific papers the user added — exactly like an external
// database record. Gated by the memory toggle; deduped by document+passage.
async function libraryEvidence(question: string, model?: string): Promise<{ evidence: EvidenceItem[]; gapNote: string | null }> {
  const memory = useMemorySettingsStore.getState();
  // Needs memory on AND the library toggle on — so a clean from-scratch run, or
  // a run where the user excluded their imported papers, cites neither.
  if (!memory.enabled || !memory.libraryEnabled) return { evidence: [], gapNote: null };
  const projectId = useProjectStore.getState().activeProjectId ?? '';
  if (!projectId) return { evidence: [], gapNote: null };
  let hits;
  let gapNote: string | null = null;
  try {
    if (memory.smartRagEnabled) {
      const result = await smartRetrieve(question, { activeProjectId: projectId, limit: 8, rerank: memory.rerankEnabled, ...(model ? { model } : {}) });
      hits = result.hits;
      gapNote = result.gapNote;
    } else {
      hits = await retrieve(question, { activeProjectId: projectId, limit: 8 });
    }
  } catch {
    return { evidence: [], gapNote: null };
  }
  // The whole corpus, so each retrieved passage can be expanded with its
  // immediate same-document neighbours (parent window) before it is cited.
  const allChunks = useRagStore.getState().chunks;
  const seen = new Set<string>();
  const out: EvidenceItem[] = [];
  for (const { chunk } of hits) {
    if (chunk.kind !== 'document' || !chunk.docId) continue;
    const key = `${chunk.docId}:${chunk.chunkIndex ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: 'library',
      title: chunk.title,
      authors: chunk.authors ?? [],
      identifiers: {
        docId: chunk.docId,
        ...(chunk.doi ? { doi: chunk.doi } : {}),
        ...(chunk.page ? { page: String(chunk.page) } : {}),
      },
      snippet: parentWindowText(chunk, allChunks, 1).slice(0, 900),
      ...(chunk.year != null ? { year: chunk.year } : {}),
      ...(chunk.url ? { url: chunk.url } : {}),
      fetchedAt: chunk.createdAt,
      provenanceHash: `library:${chunk.docId}:${chunk.chunkIndex ?? 0}`,
    });
  }
  return { evidence: out, gapNote };
}

// Query the curated genetic databases (GWAS Catalog, ClinVar) DIRECTLY, so the
// structured association evidence — and therefore the association-confidence
// score — never depends on the LLM specialist happening to pick the right tool.
// (A real run showed the specialist querying only PubMed/Europe PMC, leaving the
// score with no structured data and forced to 0%.) The calls are reported
// through the trace callbacks so GWAS Catalog and ClinVar are visible in the
// execution trace, not hidden behind the deterministic fetch. Failures are
// non-fatal.
async function geneticDatabaseEvidence(
  question: string,
  callbacks: SwarmCallbacks,
): Promise<EvidenceItem[]> {
  const med = platform().medical;
  const fetchOne = async (
    tool: string,
    run: () => Promise<{ results: EvidenceItem[] }>,
  ): Promise<EvidenceItem[]> => {
    callbacks.onToolCall('genetics', tool);
    try {
      const { results } = await run();
      callbacks.onToolResult('genetics', tool, results.length);
      return results;
    } catch {
      callbacks.onToolResult('genetics', tool, 0);
      return [];
    }
  };
  // GWAS Catalog and ClinVar match on a GENE SYMBOL or rsID, never on a full
  // sentence — passing the raw question returned 0 for real genes like MICA. Query
  // by each extracted symbol/rsID instead, and guarantee ON-TOPIC literature with
  // a focused "<gene> <disease terms>" search (the LLM specialist's own queries had
  // returned unrelated records). Falls back to the raw question only when no gene
  // is named (the readiness gate normally prevents that).
  const genes = extractGeneSymbols(question);
  const rsIds = extractRsIds(question);
  const geneTerms = [...genes, ...rsIds];
  const disease = geneDiseaseTerms(question).slice(0, 4);
  const litQuery = [genes[0] ?? geneTerms[0] ?? question, ...disease].join(' ').trim();

  const dbQueries = geneTerms.length > 0 ? geneTerms : [question];
  const perDb = Math.max(6, Math.floor(25 / dbQueries.length));

  const gwas = (
    await Promise.all(
      dbQueries.map((q) => fetchOne('gwas_catalog_search', () => med.gwas_catalog({ query: q, maxResults: perDb }))),
    )
  ).flat();
  const clinvar = (
    await Promise.all(
      dbQueries.map((q) => fetchOne('clinvar_search', () => med.clinvar({ query: q, maxResults: perDb }))),
    )
  ).flat();
  // Focused, on-topic literature so the confidence engine can score real published
  // effect sizes even when GWAS/ClinVar have no row for a niche gene-disease pair.
  const [pubmed, europepmc] =
    litQuery && geneTerms.length > 0
      ? await Promise.all([
          fetchOne('pubmed_search', () => med.pubmed({ query: litQuery, maxResults: 15 })),
          fetchOne('europepmc_fetch', () => med.europepmc({ query: litQuery, maxResults: 15 })),
        ])
      : [[], []];

  return [...gwas, ...clinvar, ...pubmed, ...europepmc];
}

/**
 * Per-variant association-confidence cards for a PAPER that names genes/variants.
 *
 * The dedicated Genetics path already scores each named gene; a comparative paper
 * ("compare Factor V Leiden, prothrombin G20210A, and MTHFR C677T …") routes to
 * the manuscript pipeline instead and produced no such cards, even when it
 * explicitly asked for a "per-variant confidence assessment". This surfaces the
 * same deterministic scoring on the paper path.
 *
 * It pulls GWAS Catalog / ClinVar structured records (which carry a gene
 * identifier), because the paper's own literature writes "factor V Leiden", not
 * "F5", so free-text attribution alone would under-count each gene's evidence.
 * Gene-gated (empty and cost-free for a non-genetic paper) and best-effort — a
 * failed database fetch just scores on the paper evidence already retrieved.
 */
/** True when the paper question names a gene or a gene-shaped token, so the
 *  structured genetic-database (GWAS/ClinVar) fetch and the per-variant cards
 *  apply. */
function paperNamesAGene(question: string): boolean {
  return genesForQuestion(question).length > 0 || extractUnrecognizedGeneTokens(question).length > 0;
}

/** Score per-variant association confidence from the SAME evidence pool the
 *  manuscript is drafted from. The structured genetic-database records are merged
 *  into that pool up front (see runSwarm), so the confidence cards and the paper
 *  narrative can never diverge — the card reading "strong" while the paper calls
 *  the variant "unaddressed" was exactly that split source of truth. */
function paperVariantAssociations(question: string, evidence: EvidenceItem[]): GeneAssociation[] {
  if (!paperNamesAGene(question)) return [];
  return geneAssociations(evidence, question);
}

export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const { question, conversation, modelFor, callbacks, dataset, signal } = opts;
  const mini = opts.mini ?? false;
  const drugFocus = opts.drugFocus ?? false;
  const geneticsFocus = opts.geneticsFocus ?? false;
  let bossModel = modelFor('boss');

  // Assemble the cross-turn context for the boss model calls: the recent window,
  // plus (when long-chat memory is supplied) the rolling summary and the
  // semantically-recalled earlier turns, within the model's history budget. The
  // raw `conversation` is intentionally kept for appraisal and gene-readiness,
  // which need full prior turns. Falls back to the recent window when no memory
  // is supplied or recall is unavailable, so behaviour is unchanged by default.
  //
  // Built on demand and memoised. The gates that refuse deterministically return
  // before this runs, so a refused message costs no recall work — and the
  // research path below awaits the same single assembly.
  let bossContextPromise: Promise<LlmMessage[]> | null = null;
  const buildBossContext = (): Promise<LlmMessage[]> => {
    bossContextPromise ??= (async () => {
      const recentWindow = budgetConversation(conversation, {
        maxChars: 8000,
        perAssistantChars: 1500,
        maxTurns: 8,
      });
      let recalledTurns: LlmMessage[] = [];
      if (opts.contextMemory?.recall) {
        try {
          const recentSet = new Set(recentWindow.map((m) => m.content));
          recalledTurns = (await opts.contextMemory.recall(question)).filter(
            (m) => !recentSet.has(m.content),
          );
        } catch {
          recalledTurns = [];
        }
      }
      return assembleContext({
        summary: opts.contextMemory?.summary,
        recalled: recalledTurns,
        recent: recentWindow,
        budgetTokens: historyTokenBudget(bossModel),
      });
    })();
    return bossContextPromise;
  };

  // Walk the routing gate chain. The order is declared in routingGates.ts and
  // asserted by its test — see that file for why it is a list rather than a
  // ladder, and for the rule that the two refusal gates must stay above every
  // gate that reaches a model.
  const gated = await runRoutingGates({
    question,
    bossModel,
    callbacks,
    signal,
    bossContext: buildBossContext,
    priorWork: () => mostRecentSubstantialAnswer(conversation),
  });
  if (gated) return gated;

  const bossContext = await buildBossContext();

  // Resolve a context-dependent follow-up ("so which is safer?") into a
  // self-contained query so the specialists search the real topic, not the
  // literal pronoun string. The paper-vs-answer decision stays on the user's
  // original phrasing.
  const paperRequest = detectPaperRequest(question);
  // Repair common biomedical misspellings (e.g. "anticouagulant" → "anticoagulant")
  // before the question drives search, concept coverage, the title and keywords —
  // a typo here otherwise cascades into a false "no direct evidence" gap and a
  // misspelled title.
  const researchQuestion = normalizeMedicalSpelling(
    await contextualizeQuestion(bossModel, question, bossContext),
  );

  // Surface the PICO frame (Population/Intervention/Comparator/Outcome) of the
  // question in the trace when it reads as a structured clinical question — the
  // systematic-review lens the answer is built through. Purely informational.
  const pico = extractPico(researchQuestion);
  if (isPicoUseful(pico)) {
    bus.emit('agent:activity', { agentId: 'boss', phase: 'tool_call', detail: `PICO — ${picoSummary(pico)}` });
  }

  // If the boss model's provider was cooled down during contextualization,
  // re-resolve it so planResearch doesn't start with a dead provider.
  if (isProviderOnCooldown(parseModelRef(bossModel).provider)) {
    const fresh = modelFor('boss');
    if (fresh !== bossModel) bossModel = fresh;
  }

  // Drug-Interactions focus: a single specialist gathers interaction evidence
  // from trusted sources and the boss writes a focused interaction report —
  // not a manuscript and not the full research team. Findings still flow into
  // the shared memory through the normal save path, so Brain benefits later.
  if (drugFocus) {
    callbacks.onBossPhase('delegating');
    // Scope memory to the drug-interaction domain for the duration of this run,
    // so the specialist is fed only its own trusted findings — never other
    // modes' general research.
    setMemoryScope('drug_interactions');
    // Search under the generic ingredient names too, so a brand-name question
    // ("panadol and catafast") retrieves the real interaction literature for
    // paracetamol and diclofenac instead of finding nothing under the brands.
    const interactionQuery = expandDrugQuery(researchQuestion);
    let specialist: SpecialistResult;
    try {
      specialist = await runSpecialist(
        agentById('pharmacist'),
        modelFor('pharmacist'),
        interactionQuery,
        callbacks,
      );
    } finally {
      clearMemoryScope();
    }
    // Keep the drug-label (OpenFDA) and terminology (RxNorm) records here — for
    // an interaction question they are authoritative trusted sources, not just
    // background, so the report can cite them for a clear regulatory-grade answer.
    let evidence = rankEvidenceByRelevance(interactionQuery, mergeEvidence([specialist]));
    // Fabrication guard: if a named drug appears in none of the retrieved
    // records, it is likely misspelled or not a real drug — refuse to grade it
    // rather than inventing a clinical interaction grade for a drug that does
    // not exist. BUT a real drug can simply be absent from the literature the
    // specialist happened to fetch (e.g. fluconazole was wrongly rejected), so
    // each flagged name is verified against RxNorm — the authoritative drug
    // terminology — before refusing. Only a name unknown to BOTH literature and
    // RxNorm is treated as fabricated; RxNorm hits are added as evidence.
    let unverified = unverifiedDrugNames(researchQuestion, evidence);
    if (unverified.length > 0) {
      const med = platform().medical;
      const rxRecords: EvidenceItem[] = [];
      const stillUnverified: string[] = [];
      await Promise.all(
        unverified.map(async (drug) => {
          callbacks.onToolCall('pharmacist', 'RxNorm');
          try {
            const { results } = await med.rxnorm(drug);
            callbacks.onToolResult('pharmacist', 'RxNorm', results.length);
            if (results.length > 0) rxRecords.push(...results);
            else stillUnverified.push(drug);
          } catch {
            callbacks.onToolResult('pharmacist', 'RxNorm', 0);
            stillUnverified.push(drug);
          }
        }),
      );
      if (rxRecords.length > 0) {
        evidence = rankEvidenceByRelevance(interactionQuery, [...evidence, ...rxRecords]);
      }
      unverified = stillUnverified;
    }
    if (unverified.length > 0) {
      callbacks.onBossPhase('answering');
      const message = unverifiedDrugMessage(unverified);
      callbacks.onAnswerToken(message);
      return { kind: 'chat', answer: message, evidence: [], specialists: [specialist], modelUsed: bossModel };
    }
    callbacks.onBossPhase('synthesizing');
    const report = await synthesizeInteractionReport(
      bossModel,
      researchQuestion,
      [specialist],
      evidence,
      callbacks.onAnswerToken,
      signal,
      drugCandidates(researchQuestion),
    );
    // A report that was never written cites nothing, so it lists no sources.
    if (report.failed) {
      return { kind: 'chat', answer: report.content, evidence: [], specialists: [specialist], modelUsed: report.modelUsed };
    }
    return {
      kind: 'research',
      answer: report.content,
      evidence,
      specialists: [specialist],
      modelUsed: report.modelUsed,
    };
  }

  // Genetics focus: the gene-expert specialist returns a gene-variant ↔ disease
  // correlation report with an app-computed association-confidence score. Its own
  // findings feed the shared memory (genetics-tagged) so the Brain benefits,
  // while the run itself is fed only its genetics-scoped intake.
  if (geneticsFocus) {
    // Clarify-before-answer: if the conversation does not yet name both a gene/
    // variant and a disease, ask for the missing piece instead of guessing.
    const conversationText = [
      ...conversation.filter((m) => m.role === 'user').map((m) => m.content),
      question,
    ].join('\n');
    const readiness = assessGeneQueryReadiness(conversationText);
    if (!readiness.ready) {
      callbacks.onBossPhase('answering');
      const message = clarificationMessage(readiness);
      callbacks.onAnswerToken(message);
      return { kind: 'chat', answer: message, evidence: [], specialists: [], modelUsed: bossModel };
    }

    callbacks.onBossPhase('delegating');
    setMemoryScope('genetics');
    let specialist: SpecialistResult;
    let dbEvidence: EvidenceItem[];
    try {
      // Run the LLM specialist (literature + narrative) and the deterministic
      // genetic-database fetch in parallel.
      [specialist, dbEvidence] = await Promise.all([
        runSpecialist(agentById('genetics'), modelFor('genetics'), researchQuestion, callbacks),
        geneticDatabaseEvidence(researchQuestion, callbacks),
      ]);
    } finally {
      clearMemoryScope();
    }
    const dbSpecialist: SpecialistResult = {
      agentId: 'genetics',
      label: 'Genetic databases',
      subQuery: researchQuestion,
      findings: '',
      evidence: dbEvidence,
      toolCalls: 2,
    };
    const evidence = rankEvidenceByRelevance(
      researchQuestion,
      mergeEvidence([specialist, dbSpecialist]),
    );
    // The percentage is computed deterministically from the structured genetic
    // records and significant published effect sizes — one score PER gene named,
    // never by the model. A made-up gene is flagged unrecognized with no score.
    const associations = geneAssociations(evidence, researchQuestion);
    callbacks.onBossPhase('synthesizing');
    // Mini / local-model path: trim the records fed to the synthesis prompt so it
    // fits a small context window. The score above already used all the evidence.
    const reportEvidence = mini ? evidence.slice(0, 8) : evidence;
    const report = await synthesizeGeneCorrelationReport(
      bossModel,
      researchQuestion,
      [specialist],
      reportEvidence,
      associations,
      callbacks.onAnswerToken,
      signal,
    );
    return {
      kind: 'research',
      answer: report.content,
      evidence,
      specialists: [specialist],
      modelUsed: report.modelUsed,
      associations,
    };
  }

  // Unrecognized-gene gate (general research + paper path). The dedicated
  // Genetics mode scores per gene and names an invented symbol as unrecognized
  // on its own, but a comparative question routed to the manuscript pipeline has
  // no such guard: a made-up "ZndR4 gene" was drafted into a paper and handed a
  // borrowed odds ratio from an unrelated record. When the question presents a
  // gene-shaped token AS a gene that is not an approved HGNC symbol, ask the
  // author to confirm or correct it before drafting rather than researching a
  // gene that may not exist. Checked on both the literal and context-resolved
  // question so a symbol survives contextualization either way.
  const unrecognizedGenes = Array.from(
    new Set([
      ...extractUnrecognizedGeneTokens(question),
      ...extractUnrecognizedGeneTokens(researchQuestion),
    ]),
  );
  if (unrecognizedGenes.length > 0) {
    callbacks.onBossPhase('answering');
    const message = unrecognizedGeneMessage(unrecognizedGenes);
    callbacks.onAnswerToken(message);
    return { kind: 'chat', answer: message, evidence: [], specialists: [], modelUsed: bossModel };
  }

  callbacks.onBossPhase('routing');
  let plan = await planResearch(bossModel, researchQuestion, bossContext);
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
    const chat = await bossChat(bossModel, question, bossContext, callbacks.onAnswerToken, signal);
    return { kind: 'chat', answer: chat.content, evidence: [], specialists: [], modelUsed: chat.modelUsed };
  }

  callbacks.onBossPhase('delegating');
  if (paperRequest) callbacks.onManuscriptSection?.('Searching');
  const specialists = await Promise.all(
    plan.tasks.map((task) =>
      runSpecialist(agentById(task.agentId), modelFor(task.agentId), task.subQuery, callbacks),
    ),
  );

  // Merge specialist findings with any matching passages from the user's
  // imported PDF library (so the Brain knows and can cite the papers the user
  // added), de-duplicate, quality-rank, then re-rank by topical relevance to the
  // (context-resolved) question so off-topic records sink or drop out before
  // they can be cited.
  const { evidence: fromLibrary, gapNote: libraryGapNote } = await libraryEvidence(researchQuestion, bossModel);
  // Landmark-trial backfill (paper path only): read the trial names the retrieved
  // reviews cite and fetch those primary reports, so the manuscript can report
  // per-trial hazard ratios instead of only pooled review numbers. Best-effort.
  let specialistsForMerge = specialists;
  if (paperRequest) {
    const trialSpecialist = await backfillLandmarkTrials(
      mergeEvidence(specialists),
      researchQuestion,
      callbacks,
    );
    if (trialSpecialist) specialistsForMerge = [...specialistsForMerge, trialSpecialist];
    // Entity-targeted backfill: for a question naming genes, deterministically
    // fetch the association literature for each gene + the disease, so a weak
    // model's poor query choice cannot leave the paper built on off-topic records.
    const entitySpecialist = await backfillNamedEntityEvidence(researchQuestion, callbacks);
    if (entitySpecialist) specialistsForMerge = [...specialistsForMerge, entitySpecialist];
    // Drug-interaction backfill: when the paper request also asks about a drug
    // interaction, fold the interaction literature into the evidence so the paper
    // addresses it instead of falsely reporting "no interaction data".
    const interactionSpecialist = await backfillDrugInteractions(researchQuestion, callbacks);
    if (interactionSpecialist) specialistsForMerge = [...specialistsForMerge, interactionSpecialist];
  }
  // For a gene-naming paper, fetch the structured genetic-database evidence
  // (GWAS Catalog / ClinVar) ONCE, up front, and fold it into the drafting pool.
  // The per-variant confidence cards are then scored from this same pool, so the
  // card and the manuscript can never diverge (the card reading "strong" while the
  // paper called the variant "unaddressed" came from the card using these records
  // and the manuscript never seeing them). Best-effort — a fetch failure leaves the
  // paper unchanged.
  let variantDbEvidence: EvidenceItem[] = [];
  if (paperRequest && paperNamesAGene(researchQuestion)) {
    try {
      variantDbEvidence = await geneticDatabaseEvidence(researchQuestion, callbacks);
    } catch {
      /* best-effort */
    }
  }
  let merged = rankEvidenceByRelevance(researchQuestion, [
    ...mergeEvidence(specialistsForMerge),
    ...fromLibrary,
    ...variantDbEvidence,
  ]);
  // Read whole papers: enrich the top open-access records with their most relevant
  // full-text passage (instead of only the abstract). Bounded + fail-safe — any
  // record without open-access full text keeps its abstract, so this never blocks
  // or degrades a run.
  if (useMemorySettingsStore.getState().fullTextEnabled) {
    merged = await enrichEvidenceWithFullText(researchQuestion, merged);
  }
  if (libraryGapNote) {
    bus.emit('agent:activity', {
      agentId: 'boss',
      phase: 'tool_call',
      detail: libraryGapNote,
    });
  }

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
    // Score per-variant association confidence in parallel with preparation and
    // drafting, so a gene-naming paper carries the same confidence cards the
    // Genetics path shows without adding wall-clock time. Empty for a non-genetic
    // paper. Awaited only at the return sites below.
    const associations = paperVariantAssociations(researchQuestion, merged);
    // Phase 1: blocking preparation (title, extraction, claims, user review)
    const prep = await preparePaperLedger({
      question: researchQuestion,
      bossModel,
      evidence: merged,
      // Include the backfill specialists (trial / entity / drug-interaction) so
      // their role digest reaches the drafting model — this is what carries the
      // registry drug-identity note ("Klacid = clarithromycin") into the paper.
      specialists: specialistsForMerge,
      standard: manuscriptStandardForQuestion(researchQuestion),
      ...(dataset ? { dataset } : {}),
      ...(gap.note ? { evidenceGap: gap.note } : {}),
      mini,
      onStage: (stage) => callbacks.onManuscriptSection?.(stage),
      ...(opts.onClaimLedger ? { onClaimLedger: opts.onClaimLedger } : {}),
      ...(signal ? { signal } : {}),
    });

    // Phase 2: async drafting so the UI frees immediately after claim review.
    if (opts.onPaperDraftComplete) {
      // Fire-and-forget: drafting continues in the background.
      compileManuscriptFromLedger(prep)
        .then((manuscript) => {
          opts.onPaperDraftComplete!({
            kind: 'research',
            answer: manuscriptToReadableText(manuscript),
            evidence: merged,
            specialists,
            manuscript,
            modelUsed: bossModel,
            ...(associations.length ? { associations } : {}),
          });
        })
        .catch((error) => {
          opts.onPaperDraftComplete!({
            kind: 'research',
            answer: `Drafting failed: ${error instanceof Error ? error.message : String(error)}`,
            evidence: merged,
            specialists,
            modelUsed: bossModel,
          });
        });
      return {
        kind: 'drafting',
        answer: 'Drafting manuscript in the background…',
        evidence: merged,
        specialists,
        modelUsed: bossModel,
      };
    }

    // Fallback: old blocking behaviour when no async callback is provided.
    const manuscript = await compileManuscriptFromLedger(prep);
    return {
      kind: 'research',
      answer: manuscriptToReadableText(manuscript),
      evidence: merged,
      specialists,
      manuscript,
      modelUsed: bossModel,
      ...(associations.length ? { associations } : {}),
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

  // Save episodic memory of this research run
  const projectId = useProjectStore.getState().activeProjectId ?? '';
  if (projectId) {
    const episode = createEpisode({
      projectId,
      query: researchQuestion,
      subQueries: plan.tasks.map((t) => t.subQuery),
      evidence: citableEvidence,
      gaps: gap.uncovered,
      modelUsed: synth.modelUsed,
      specialists,
      citedChunks: citableEvidence
        .map((e) => e.provenanceHash)
        .filter((h): h is string => !!h),
    });
    useLearningStore.getState().addEpisode(episode);

    // Autonomous study: when memory is on, drain this project's top open gaps in
    // the background so the next query on those topics finds the agent already
    // prepared. Fire-and-forget on idle; failures are silent. Gated by memory so
    // a clean "from scratch" session never triggers background fetches.
    if (useMemorySettingsStore.getState().enabled) {
      const study = () => {
        void studyTopGaps(projectId).catch(() => {});
      };
      const w = typeof window !== 'undefined' ? window : undefined;
      if (w && typeof w.requestIdleCallback === 'function') w.requestIdleCallback(study, { timeout: 4000 });
      else setTimeout(study, 0);
    }
  }

  return {
    kind: 'research',
    answer: synth.content,
    evidence: citableEvidence,
    specialists,
    modelUsed: synth.modelUsed,
  };
}
