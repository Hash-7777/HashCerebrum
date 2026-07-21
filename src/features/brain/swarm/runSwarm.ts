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
  appraisePriorWork,
  bossChat,
  contextualizeQuestion,
  drugCandidates,
  IDENTITY_ANSWER,
  isIdentityQuestion,
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
  HARMFUL_REQUEST_REFUSAL,
  isHarmfulRequest,
  isJailbreakAttempt,
  isMetaOrAppQuestion,
  isOffTopicQuestion,
  isPriorWorkReviewRequest,
  isPromptInjection,
  PROMPT_INJECTION_REFUSAL,
  isSystemPromptRequest,
  SYSTEM_PROMPT_REFUSAL,
  isSelfHarmQuery,
  isSmallTalk,
  isCodingRequest,
  manuscriptStandardForQuestion,
  SELF_HARM_MESSAGE,
} from './paper';
import type { LlmMessage } from '@core/llm/types';
import { isProviderOnCooldown } from '@core/llm/failover';
import { parseModelRef } from '@core/llm/modelCatalog';
import { manuscriptToReadableText } from './manuscript';
import { normalizeMedicalSpelling } from './queryNormalize';
import { CONTEXT_ONLY_SOURCES, preparePaperLedger, compileManuscriptFromLedger } from './paperPipeline';
import { runSpecialist } from './specialist';
import { backfillLandmarkTrials } from './trialBackfill';
import { backfillDrugInteractions } from './interactionBackfill';
import { backfillNamedEntityEvidence } from './entityBackfill';
import { expandDrugQuery } from './drugAliases';
import { budgetConversation } from './conversationBudget';
import { assembleContext } from '../context/assembleContext';
import { historyTokenBudget } from '../context/tokenBudget';
import type { SpecialistResult, SpecialistTask, SwarmCallbacks, SwarmOptions, SwarmResult } from './types';

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
  // User-imported library papers are deliberately chosen primary sources — rank
  // them high, just below PubMed, so the Brain leans on the user's own corpus.
  library: 11,
  // Curated genetic databases — trusted, quantitative association evidence —
  // rank just below PubMed/library and above the general literature graph.
  gwas_catalog: 9,
  clinvar: 8,
  ctgov: 6,
  europepmc: 5,
  openalex: 4,
  semantic_scholar: 4,
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
  // conversational / context / verb words that are about the request, not the
  // subject — these leaked into the evidence-gap note ("no records cover:
  // building, already, memory, reuse" / "summarize, ignore, instead").
  'building', 'build', 'already', 'memory', 'reuse', 'reusing', 'prior', 'previous', 'existing',
  'findings', 'relevant', 'leverage', 'incorporate', 'drawing', 'based', 'publication', 'ready',
  'assessing', 'assess', 'evaluate', 'evaluating', 'examine', 'explore', 'investigate', 'determine',
  'identify', 'describe', 'discuss', 'outline', 'consider', 'including', 'include', 'summarize',
  'summarise', 'summary', 'ignore', 'retrieved', 'instead', 'provide', 'explain',
  // proof / claim verbs and study-design descriptors — these qualify HOW the
  // question is asked, not the medical subject, so they must never surface as an
  // uncovered concept ("no records cover: cures / according / proving").
  'according', 'cure', 'cures', 'cured', 'curing', 'prove', 'proves', 'proving', 'proven', 'proof',
  'show', 'shows', 'showing', 'demonstrate', 'demonstrates', 'demonstrating', 'randomised',
  'randomized', 'controlled', 'trial', 'trials', 'study', 'studies',
  // structural / study-type / label words — these describe the deliverable or the
  // review type, never the medical subject, so they must never surface as an
  // uncovered concept ("no records cover: title / systematic / impact" leaked
  // from a 'Title:' label and the review-type words; "type" is the leftover of
  // "type 2 diabetes" splitting on the digit).
  'title', 'systematic', 'meta-analysis', 'metaanalysis', 'meta', 'impact', 'adults', 'adult', 'type',
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
  statin: ['hmg-coa reductase inhibitor', 'simvastatin', 'atorvastatin', 'rosuvastatin', 'pravastatin', 'lovastatin', 'fluvastatin', 'pitavastatin'],
  statins: ['hmg-coa reductase inhibitors', 'simvastatin', 'atorvastatin', 'rosuvastatin', 'pravastatin', 'lovastatin', 'fluvastatin', 'pitavastatin'],
  simvastatin: ['statin', 'hmg-coa reductase inhibitor'],
  atorvastatin: ['statin', 'hmg-coa reductase inhibitor'],
  rosuvastatin: ['statin', 'hmg-coa reductase inhibitor'],
  asthma: ['airway inflammation', 'bronchial hyperresponsiveness', 'airway remodeling', 'chronic airway disease'],
  copd: ['chronic obstructive pulmonary disease', 'emphysema', 'chronic bronchitis'],
  diabetes: ['diabetic', 'hyperglycemia', 'type 1 diabetes', 'type 2 diabetes', 't1dm', 't2dm'],
  hypertension: ['high blood pressure', 'elevated blood pressure', 'arterial hypertension'],
  obesity: ['overweight', 'bmi', 'body mass index', 'adiposity'],
  warfarin: ['vitamin k antagonist', 'coumarin', 'anticoagulant'],
  // Anticoagulant is a drug CLASS: a record naming any member (warfarin, a NOAC/
  // DOAC, heparin) covers the "anticoagulant" concept. Without this, an
  // anticoagulant question wrongly reads as an evidence gap even when the corpus
  // is full of warfarin / edoxaban / rivaroxaban studies.
  anticoagulant: ['anticoagulation', 'anticoagulants', 'oral anticoagulant', 'noac', 'doac', 'vitamin k antagonist', 'warfarin', 'rivaroxaban', 'apixaban', 'edoxaban', 'dabigatran', 'heparin', 'enoxaparin'],
  anticoagulants: ['anticoagulation', 'anticoagulant', 'oral anticoagulant', 'noac', 'doac', 'vitamin k antagonist', 'warfarin', 'rivaroxaban', 'apixaban', 'edoxaban', 'dabigatran', 'heparin', 'enoxaparin'],
  anticoagulation: ['anticoagulant', 'anticoagulants', 'oral anticoagulant', 'noac', 'doac', 'vitamin k antagonist', 'warfarin', 'rivaroxaban', 'apixaban', 'edoxaban', 'dabigatran'],
  aspirin: ['acetylsalicylic acid', 'antiplatelet', 'nsaid'],
  nsaid: ['nonsteroidal anti-inflammatory', 'ibuprofen', 'naproxen', 'diclofenac'],
  nsaids: ['nonsteroidal anti-inflammatory drugs', 'ibuprofen', 'naproxen', 'diclofenac'],
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
// sources do not support.
/** Strip structured data blocks and instruction sentences from the question so
 *  they do not pollute concept extraction (fixes I3 gap-word leak). */
function questionForConceptExtraction(question: string): string {
  let q = question;
  // Drop structured data blocks (reuses the same heuristic as promptEffectData).
  const dataBlock = /(?:data|trials?|studies?|effect sizes?)\s*[:\-]\s*[\s\S]*?(?:\n\n|\n(?:requirements?|instructions?|context|outline|must|should)\b|$)/i;
  q = q.replace(dataBlock, ' ');
  // Drop trailing instruction sentences — only when they start a line or follow
  // a newline, so mid-sentence words like "use" / "with" are not stripped.
  const instructionLine =
    /(?:^|\n)\s*(?:requirements?|instructions?|context|outline|must|should|write|draft|generate|produce|including)\b[^\n]*/gim;
  q = q.replace(instructionLine, ' ');
  return q;
}

export function assessEvidenceSufficiency(
  question: string,
  evidence: EvidenceItem[],
): { uncovered: string[]; note: string | null } {
  const cleaned = questionForConceptExtraction(question);
  const groups = coreConceptGroups(cleaned);
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
  if (uncovered.length === 0) return { uncovered, note: null };
  // TOTAL MISS: none of the question's concepts appear in the evidence.
  // This happens when the query is off-topic or the databases have nothing
  // relevant. Refuse synthesis rather than hallucinating a manuscript from
  // unrelated records.
  if (uncovered.length === groups.length) {
    const note =
      `The retrieved records contain NO evidence related to the requested topic ` +
      `(${uncovered.slice(0, 4).join(', ')}${uncovered.length > 4 ? '…' : ''}). ` +
      `State plainly that the databases returned no relevant sources and do NOT synthesise an answer.`;
    return { uncovered, note };
  }
  // PARTIAL gap: some concepts covered, some missing.
  const note =
    `The retrieved records contain NO direct evidence for the following requested concept(s): ` +
    `${uncovered.join(', ')}. State this gap explicitly and early, attribute it to the absence of ` +
    `retrieved sources, and do not imply that evidence exists for these concepts.`;
  return { uncovered, note };
}

/**
 * Identify "core" medical subject terms in the question — terms that are
 * specific enough that an off-topic paper will not match them. Generic words
 * like "effect", "impact", "patients" are excluded.
 */
export function coreConceptGroups(question: string): string[][] {
  const generic = new Set([
    'effect', 'effects', 'impact', 'impacts', 'influence', 'role', 'use', 'using',
    'long', 'term', 'short', 'run', 'time', 'duration', 'patient', 'patients',
    'people', 'individual', 'individuals', 'population', 'populations',
    'treatment', 'treatments', 'therapy', 'therapies', 'intervention',
    'disease', 'diseases', 'condition', 'conditions', 'disorder', 'disorders',
    'outcome', 'outcomes', 'result', 'results', 'finding', 'findings',
    'association', 'associations', 'relationship', 'relationships',
    'comparison', 'comparisons', 'versus', 'vs', 'compared', 'compare',
    'safety', 'efficacy', 'efficacious', 'effective', 'effectiveness',
    'clinical', 'medical', 'health', 'healthcare',
  ]);
  const all = conceptGroups(question);
  return all.filter((group) => !generic.has(group[0]!));
}

// Drug / drug-class indicator terms. A question concept built from one of these
// (or matching a common drug-name suffix) is treated as an INTERVENTION — the
// thing the review is actually about — as opposed to the population or setting.
const DRUG_CONCEPT_TERMS = new Set([
  'anticoagulant', 'anticoagulants', 'anticoagulation', 'antiplatelet', 'antidiabetic',
  'antihypertensive', 'antibiotic', 'antibiotics', 'warfarin', 'heparin', 'enoxaparin',
  'rivaroxaban', 'apixaban', 'edoxaban', 'dabigatran', 'noac', 'doac', 'aspirin', 'nsaid',
  'nsaids', 'statin', 'statins', 'metformin', 'insulin', 'digoxin', 'clopidogrel',
  'sertraline', 'tramadol', 'ibuprofen', 'naproxen', 'diclofenac', 'lisinopril',
  'hydrochlorothiazide', 'amoxicillin', 'atorvastatin', 'simvastatin', 'dapagliflozin',
  'ipragliflozin', 'pioglitazone', 'acetaminophen', 'paracetamol',
]);

// Common drug-name suffixes so an un-listed agent is still recognised as a drug
// (rivaroxaban→xaban, atorvastatin→statin, lisinopril→pril, metoprolol→olol …).
const DRUG_SUFFIX_RX = /(?:statin|sartan|pril|olol|azepam|cycline|micin|mycin|floxacin|tinib|mab|gliflozin|gliptin|parin|xaban|caine|prazole|coxib)$/;

function isDrugTerm(term: string): boolean {
  return DRUG_CONCEPT_TERMS.has(term) || DRUG_SUFFIX_RX.test(term);
}

// Concept groups that name a drug or drug-class — the intervention(s) under study.
function interventionConceptGroups(question: string): string[][] {
  return conceptGroups(question).filter((group) => group.some(isDrugTerm));
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
  const coreGroups = coreConceptGroups(question);
  const interventionGroups = interventionConceptGroups(question);
  if (groups.length === 0) return evidence;
  const scored = evidence
    .map((record, index) => ({ record, index, m: conceptCoverage(record, groups), core: conceptCoverage(record, coreGroups) }))
    .sort((a, b) => b.m - a.m || b.core - a.core || a.index - b.index);
  const minConcepts = groups.length >= 3 ? 2 : 1;
  const strong = scored.filter((s) => s.m >= minConcepts);
  const loose = scored.filter((s) => s.m > 0);
  // Core-concept gate: if we have core groups, require at least 1 core match
  // for a record to be considered on-topic. This drops off-topic noise like
  // the Romania aging paper on a statin+asthma query.
  const coreGated = coreGroups.length > 0 ? scored.filter((s) => s.core >= 1) : scored;
  const candidate = strong.length >= 6 ? strong : loose.length >= 6 ? loose : scored;
  const kept = coreGated.length >= 6 ? coreGated.filter((s) => candidate.includes(s)) : candidate;
  // Intervention gate: when the question names a drug / drug-class, an on-topic
  // record must actually mention that intervention. This drops records that
  // share only the population/setting — e.g. "corneal edema in elderly diabetic
  // cataract patients" on an *anticoagulant* in elderly diabetics question —
  // which the concept-conjunctive bar alone keeps (it matches diabetes+elderly).
  // Applied only when ≥6 intervention-bearing records survive, so a sparse topic
  // is never gutted.
  if (interventionGroups.length > 0) {
    const onIntervention = kept.filter((s) => conceptCoverage(s.record, interventionGroups) >= 1);
    if (onIntervention.length >= 6) return onIntervention.map((s) => s.record);
  }
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
async function paperVariantAssociations(
  question: string,
  evidence: EvidenceItem[],
  callbacks: SwarmCallbacks,
): Promise<GeneAssociation[]> {
  const named = genesForQuestion(question).length > 0 || extractUnrecognizedGeneTokens(question).length > 0;
  if (!named) return [];
  let dbEvidence: EvidenceItem[] = [];
  try {
    dbEvidence = await geneticDatabaseEvidence(question, callbacks);
  } catch {
    /* best-effort — score on the paper evidence when the database fetch fails */
  }
  return geneAssociations([...evidence, ...dbEvidence], question);
}

export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const { question, conversation, modelFor, callbacks, dataset, signal } = opts;
  const mini = opts.mini ?? false;
  const drugFocus = opts.drugFocus ?? false;
  const geneticsFocus = opts.geneticsFocus ?? false;
  let bossModel = modelFor('boss');

  // Identity / "what model are you" questions get a fixed, branded answer so the
  // underlying language model is never disclosed — the HashCerebrum agent.
  if (isIdentityQuestion(question)) {
    callbacks.onBossPhase('answering');
    callbacks.onAnswerToken(IDENTITY_ANSWER);
    return { kind: 'chat', answer: IDENTITY_ANSWER, evidence: [], specialists: [], modelUsed: bossModel };
  }

  // Safety gates run before any routing so a harmful or self-harm request can
  // never be turned into a research run or a model-improvised answer. Both
  // replies are deterministic.
  if (isSelfHarmQuery(question)) {
    callbacks.onBossPhase('answering');
    callbacks.onAnswerToken(SELF_HARM_MESSAGE);
    return { kind: 'chat', answer: SELF_HARM_MESSAGE, evidence: [], specialists: [], modelUsed: bossModel };
  }
  if (isHarmfulRequest(question)) {
    callbacks.onBossPhase('answering');
    callbacks.onAnswerToken(HARMFUL_REQUEST_REFUSAL);
    return { kind: 'chat', answer: HARMFUL_REQUEST_REFUSAL, evidence: [], specialists: [], modelUsed: bossModel };
  }

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

  // Assemble the cross-turn context for the boss model calls: the recent window,
  // plus (when long-chat memory is supplied) the rolling summary and the
  // semantically-recalled earlier turns, within the model's history budget. The
  // raw `conversation` is intentionally kept for appraisal and gene-readiness,
  // which need full prior turns. Falls back to the recent window when no memory
  // is supplied or recall is unavailable, so behaviour is unchanged by default.
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
  const bossContext = assembleContext({
    summary: opts.contextMemory?.summary,
    recalled: recalledTurns,
    recent: recentWindow,
    budgetTokens: historyTokenBudget(bossModel),
  });

  // An instruction addressed to the assistant, embedded in the message, stops
  // the run. It is NOT answered in chat: routing an otherwise legitimate
  // research question onto the chat path silently strips retrieval, the drug
  // and gene lexicons, citation handling, and the honesty pass, and the answer
  // still renders with the same authority — so a detected injection would have
  // *disabled* every other guard. Ask the user to remove it instead. The reply
  // is deterministic and costs no model call.
  if (isPromptInjection(question)) {
    callbacks.onBossPhase('answering');
    callbacks.onAnswerToken(PROMPT_INJECTION_REFUSAL);
    return {
      kind: 'chat',
      answer: PROMPT_INJECTION_REFUSAL,
      evidence: [],
      specialists: [],
      modelUsed: bossModel,
    };
  }

  // A request to disclose, reproduce, "improve", or reconfigure the app's own
  // system prompt / configuration is refused deterministically — never handed to
  // the model. Free-generating it produced a plausible but entirely fabricated
  // HashCerebrum system prompt, invented modes, and file-edit steps for a prompt
  // file that does not exist; authoring a fake copy of the app's own security
  // rules is as harmful as leaking the real ones. Costs no model call.
  if (isSystemPromptRequest(question)) {
    callbacks.onBossPhase('answering');
    callbacks.onAnswerToken(SYSTEM_PROMPT_REFUSAL);
    return {
      kind: 'chat',
      answer: SYSTEM_PROMPT_REFUSAL,
      evidence: [],
      specialists: [],
      modelUsed: bossModel,
    };
  }

  // Meta / app-introspection questions are not biomedical research — answer
  // them in plain chat (the boss explains or declines) instead of launching the
  // research swarm, which turned them into refusals rendered as "Research
  // result · N references" documents.
  if (isMetaOrAppQuestion(question)) {
    callbacks.onBossPhase('answering');
    const chat = await bossChat(bossModel, question, bossContext, callbacks.onAnswerToken, signal);
    return { kind: 'chat', answer: chat.content, evidence: [], specialists: [], modelUsed: chat.modelUsed };
  }

  // Jailbreak / roleplay / translation-bypass / token-smuggling / reverse-
  // psychology attempts must NEVER reach the research swarm. Route to chat
  // mode where the hardened system prompt refuses them cleanly.
  if (isJailbreakAttempt(question)) {
    callbacks.onBossPhase('answering');
    const chat = await bossChat(bossModel, question, bossContext, callbacks.onAnswerToken, signal);
    return { kind: 'chat', answer: chat.content, evidence: [], specialists: [], modelUsed: chat.modelUsed };
  }

  // Off-topic questions disguised as medical requests (e.g. "evaluate the
  // psychological themes of historical figures...Napoleon at Waterloo") should
  // not launch a research swarm that retrieves unrelated evidence and writes a
  // bogus manuscript. Route to chat with a refusal.
  if (isOffTopicQuestion(question)) {
    callbacks.onBossPhase('answering');
    const chat = await bossChat(bossModel, question, bossContext, callbacks.onAnswerToken, signal);
    return { kind: 'chat', answer: chat.content, evidence: [], specialists: [], modelUsed: chat.modelUsed };
  }

  // A software/coding request ("code a RAG system", "write a Python script") is
  // not a biomedical question — answer it in chat instead of launching a
  // literature search that returns nothing on point.
  if (isCodingRequest(question)) {
    callbacks.onBossPhase('answering');
    const chat = await bossChat(bossModel, question, bossContext, callbacks.onAnswerToken, signal);
    return { kind: 'chat', answer: chat.content, evidence: [], specialists: [], modelUsed: chat.modelUsed };
  }

  // A bare greeting / thanks / acknowledgement is answered conversationally and
  // never routed to the research swarm — deterministic, so it holds even when
  // the planner is rate-limited (whose safe default is "research", which is how
  // a plain "hi" became a literature search).
  if (isSmallTalk(question)) {
    callbacks.onBossPhase('answering');
    const chat = await bossChat(bossModel, question, bossContext, callbacks.onAnswerToken, signal);
    return { kind: 'chat', answer: chat.content, evidence: [], specialists: [], modelUsed: chat.modelUsed };
  }

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
        agentById('drug_interactions'),
        modelFor('drug_interactions'),
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
          callbacks.onToolCall('drug_interactions', 'RxNorm');
          try {
            const { results } = await med.rxnorm(drug);
            callbacks.onToolResult('drug_interactions', 'RxNorm', results.length);
            if (results.length > 0) rxRecords.push(...results);
            else stillUnverified.push(drug);
          } catch {
            callbacks.onToolResult('drug_interactions', 'RxNorm', 0);
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
  let merged = rankEvidenceByRelevance(researchQuestion, [...mergeEvidence(specialistsForMerge), ...fromLibrary]);
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
    const associationsPromise = paperVariantAssociations(researchQuestion, merged, callbacks);
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
        .then(async (manuscript) => {
          const associations = await associationsPromise;
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
    const associations = await associationsPromise;
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
