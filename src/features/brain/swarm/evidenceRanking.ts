// Which retrieved records a turn keeps, and in what order. Records from every
// specialist are merged under one identity, conference-proceeding noise is
// dropped, and what remains is ranked by source credibility and by how many of
// the question's distinct concepts each record actually covers — so a record
// about the exact intersection asked outranks one that matches a single term.
//
// assessEvidenceSufficiency names the concepts no retrieved record covers, so
// the answer states the gap instead of implying depth the sources lack.

import type { EvidenceItem } from '@platform/index';
import type { SpecialistResult } from './types';

function evidenceKey(record: EvidenceItem): string {
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

// Assess whether the retrieved evidence actually covers the question's
// concepts. Returns the concepts that NO retrieved record addresses — the
// honest gaps. These are surfaced to the user and named for the drafting model
// so the output states the gap plainly instead of implying depth that the
// sources do not support.
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
function coreConceptGroups(question: string): string[][] {
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
