import { completeWithModelChain } from '@core/llm/ProviderRegistry';
import { bus } from '@core/bus/EventBus';
import type { EvidenceItem } from '@platform/index';
import {
  parseAbstract,
  sectionBodyFromReply,
  SECTION_PLAN,
  type Manuscript,
  type ManuscriptSection,
  type SectionSpec,
} from './manuscript';
import { buildPublicationArtifact } from './publication';
import type {
  ClaimLedgerEntry,
  EvidenceExtraction,
  EvidenceStrength,
  ExtractedEffectValue,
  ManuscriptStandard,
  PaperBlueprint,
  PaperPackageQa,
  UploadedDatasetSummary,
  ValidationIssue,
} from './publicationTypes';
import { datasetSummaryForPrompt } from './statistics';
import type { SpecialistResult } from './types';

const MAX_LEDGER_CLAIMS_PER_SECTION = 12;
const SECTION_TOKENS = 5800;
// Brain Mini drafts shorter sections so a small / free model finishes quickly.
const MINI_SECTION_TOKENS = 1600;
const MAX_SECTION_PASSES = 4;
const MAX_QA_REPAIR_SECTIONS = 4;
const TRUSTED_EVIDENCE_SOURCES = new Set<EvidenceItem['source']>([
  'pubmed',
  'europepmc',
  'ctgov',
  'openalex',
]);
// Drug-label / drug-terminology sources. They inform specialist context but
// are not peer-reviewed literature, so they are never counted as primary
// evidence and never appear as numbered citations in a synthesized answer.
export const CONTEXT_ONLY_SOURCES = new Set<EvidenceItem['source']>(['openfda', 'rxnorm']);

// Minimum trusted primary (non drug-label) records required before an
// automated evidence-review draft is allowed to export. Raised from 3 to 5 to
// reject thin "cheap research" drafts; deeper retrieval makes this easy to meet
// for any genuine question.
const MIN_PRIMARY_EVIDENCE = 5;

// Visible marker prefixed to any section the pipeline could not properly draft
// or repair, so an incomplete section is never silently shipped as if finished.
const SECTION_REVIEW_FLAG = '⚠ SECTION NEEDS REVIEW —';

const SECTION_SYSTEM = `You are The Cerebrum, the final biomedical manuscript compiler for HashCerebrum. The full manuscript is being assembled one section at a time. You are writing EXACTLY ONE SECTION — the section named in the prompt and nothing else.

DEPTH REQUIREMENT — this is the most important instruction:
- Write to the UPPER end of the target word range. A thorough, substantive, and deeply developed section is the primary goal.
- Every point must be fully elaborated: state the finding, explain its mechanism or significance, place it in clinical context, note its limitations, and connect it to the broader question. Never write a brief statement when a full paragraph of explanation is appropriate.
- A section that merely lists findings will be rejected. Develop each theme across multiple complete sentences and multiple paragraphs.
- If the evidence is genuinely thin for this section, write a complete and transparent evidence-gap analysis — explain what is missing, why it matters, and what the absence implies — rather than producing a short section.

EVIDENCE-REVIEW INTEGRITY — this overrides any instinct to write a conventional primary study:
- This manuscript is an AUTOMATED REVIEW of already-published literature that the agents retrieved. You did NOT conduct a study of your own.
- NEVER claim or imply that original data were collected. Do NOT write that "a retrospective cohort study was conducted", "we enrolled/recruited patients", "electronic health records were analysed", "propensity-score matching was applied", "AKI was defined by KDIGO in our cohort", or any equivalent — these are fabrications.
- The Methods are ONLY the automated literature search and synthesis workflow (databases queried, search terms, eligibility, evidence-strength grading). There is no patient cohort, no dataset (unless an uploaded dataset is explicitly provided to you), no primary outcome you measured.
- Report findings strictly as what the retrieved sources report ("study [S3] reported…"), never as results you produced. Any numeric result, incidence, or effect must be attributed to a specific retrieved source.

CRITICAL FORMATTING RULES — deviations corrupt the manuscript pipeline:
- Begin your reply with the first word of the section body. No preamble, no heading, no title, no number.
- Write ONLY the content for the requested section. Never write content for any other section.
- STRICTLY FORBIDDEN: numbered outlines (1. 2. 3.), section headers, sub-headings, a table of contents, a document title, or phrases like "Introduction:", "Methods:", "Discussion:".
- STRICTLY FORBIDDEN: markdown tables, bullet lists (-, •, *), or numbered lists.
- Use continuous academic prose paragraphs separated by blank lines only.
- Every factual claim must cite one or more approved [S#] source markers.
- Do not cite sources not assigned in the approved ledger.
- Do not create a References or Bibliography section; references are app-owned.
- Do not invent study findings, PMIDs, DOIs, authors, years, p-values, confidence intervals, odds ratios, hazard ratios, pooled effects, or meta-analysis results.
- Report numeric statistics only when they appear in the extracted numeric support or the uploaded dataset statistics block.`;

const STOPWORDS = new Set([
  'about',
  'after',
  'against',
  'analysis',
  'and',
  'are',
  'between',
  'during',
  'from',
  'generate',
  'into',
  'make',
  'paper',
  'research',
  'review',
  'study',
  'their',
  'them',
  'there',
  'these',
  'this',
  'those',
  'what',
  'which',
  'with',
]);

// Words that describe the REQUEST or the deliverable ("make a full research
// paper about ...") rather than the subject. Stripped from the fallback title
// and from keyword extraction so neither echoes the user's instruction verbatim
// (the source of titles like "Full reaserch paper about ..." and keywords like
// "full, reaserch"). Includes common misspellings of "research".
const META_INSTRUCTION_WORDS = new Set([
  'make', 'write', 'draft', 'create', 'generate', 'produce', 'compose', 'prepare', 'give', 'need',
  'want', 'please', 'full', 'complete', 'comprehensive', 'detailed', 'thorough', 'professional',
  'publishable', 'proper', 'research', 'reaserch', 'reasearch', 'reserch', 'paper', 'manuscript',
  'article', 'report', 'document', 'about', 'regarding', 'concerning', 'statistics', 'statistical',
  'stats', 'numbers', 'numeric', 'data',
]);

// Common typos corrected before a token reaches a title or keyword list.
const TYPO_FIXES: Record<string, string> = {
  reaserch: 'research',
  reasearch: 'research',
  reserch: 'research',
  mecanism: 'mechanism',
  mechanim: 'mechanism',
  pharmacolgy: 'pharmacology',
  warafin: 'warfarin',
  digoxine: 'digoxin',
  cardiovascual: 'cardiovascular',
  cardiovasclar: 'cardiovascular',
  cardivascular: 'cardiovascular',
  diabetis: 'diabetes',
  hypertention: 'hypertension',
};

const STRUCTURAL_WORDS = new Set(['a', 'an', 'the', 'me', 'on', 'of', 'for', 'to', 'with', 'in']);

function fixTypos(text: string): string {
  return text.replace(/[A-Za-z]+/g, (w) => TYPO_FIXES[w.toLowerCase()] ?? w);
}

// Strip leading request/deliverable words ("make a full research paper about")
// token by token — robust to word order and misspellings, unlike a fixed regex.
function stripLeadingMeta(text: string): string {
  const tokens = text.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const w = tokens[i]!.toLowerCase().replace(/[^a-z]/g, '');
    if (META_INSTRUCTION_WORDS.has(w) || STRUCTURAL_WORDS.has(w)) i += 1;
    else break;
  }
  return tokens.slice(i).join(' ');
}

// Strip a trailing "with statistics / and stats / including numeric data" clause
// — an instruction about presentation, not part of the subject.
function stripTrailingMeta(text: string): string {
  return text
    .replace(/[\s,]+(with|and|including|plus|featuring)\s+(statistics|statistical analysis|stats|numbers|numeric data|data|figures)\s*$/i, '')
    .trim();
}

const SECTION_KEYWORDS: Array<{ section: string; terms: RegExp[] }> = [
  {
    section: 'Mechanistic and Pharmacologic Evidence',
    terms: [
      /\bmechanis(?:m|tic)\b/i,
      /\bpharmacolog/i,
      /\bpharmacokinetic/i,
      /\bpharmacodynamic/i,
      /\bdrug\b/i,
      /\bmetabolism\b/i,
      /\benzyme\b/i,
      /\btransporter\b/i,
      /\breceptor\b/i,
      /\binteraction\b/i,
    ],
  },
  {
    section: 'Clinical Evidence and Safety Outcomes',
    terms: [
      /\bclinical\b/i,
      /\bsafety\b/i,
      /\badverse\b/i,
      /\boutcome\b/i,
      /\brisk\b/i,
      /\befficacy\b/i,
      /\bmortality\b/i,
      /\bbleeding\b/i,
      /\btoxicity\b/i,
    ],
  },
  {
    section: 'Trial and Registry Evidence',
    terms: [/\btrial\b/i, /\brandomi[sz]ed\b/i, /\bregistry\b/i, /\bNCT\d+/i, /\bclinicaltrials\.gov\b/i],
  },
];

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Returns true when a model has clearly written a complete document structure
 * (numbered section outline, multiple markdown headings, or multi-section body)
 * instead of a single prose section. Used to reject and fall back to the
 * deterministic gap section rather than storing garbage.
 */
function looksLikeWholeDocument(text: string): boolean {
  const normalized = text.replace(/\r\n/g, '\n');
  // Two or more numbered top-level items at the start of lines
  const numberedItems = (normalized.match(/^[1-9]+\.\s+/gm) ?? []).length;
  if (numberedItems >= 2) return true;
  // Three or more markdown headings → the model wrote a complete document
  const markdownHeadings = (normalized.match(/^#{1,3}\s+\S/gm) ?? []).length;
  if (markdownHeadings >= 3) return true;
  // Combination of Introduction + Discussion/Conclusion + Methods/Results keywords
  // as standalone headings (all-caps or Title Case alone on a line)
  const standaloneHeadings = (normalized.match(/^(Introduction|Background|Methods?|Results?|Discussion|Conclusion|Abstract)\s*$/gmi) ?? []).length;
  if (standaloneHeadings >= 3) return true;
  return false;
}

/**
 * Strip a whole-document reply down to what looks like the target section body.
 * Returns null if we cannot extract meaningful content.
 */
function extractSectionFromDocument(text: string, heading: string): string | null {
  const normalized = text.replace(/\r\n/g, '\n');
  // Try to find the target section heading and extract its content
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(
    `(?:^#{1,3}\\s*${escapedHeading}\\b[^\\n]*\\n|^${escapedHeading}\\s*\\n)([\\s\\S]+?)(?=\\n#{1,3}\\s+|\\n[A-Z][A-Za-z\\s]{3,30}\\n[-=]{3,}|$)`,
    'im',
  );
  const match = normalized.match(rx);
  if (match?.[1]) {
    const body = match[1].trim();
    if (body.split(/\s+/).length > 80) return body;
  }
  // Last resort: take everything after the first heading
  const afterFirstHeading = normalized.replace(/^.*?\n(?:#{1,3}[^\n]+|[A-Z][^\n]{3,40})\n/m, '');
  if (afterFirstHeading.split(/\s+/).length > 80) return afterFirstHeading.trim();
  return null;
}

function marker(index: number): string {
  return `[S${index + 1}]`;
}

function normalizeForHash(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sourceIdentity(record: EvidenceItem): string {
  const doi = clean(record.identifiers?.doi).toLowerCase();
  if (doi) return `doi:${doi}`;
  const pmid = clean(record.identifiers?.pmid).toLowerCase();
  if (pmid) return `pmid:${pmid}`;
  const nct = clean(record.identifiers?.nctId ?? record.identifiers?.nct).toLowerCase();
  if (nct) return `nct:${nct}`;
  const url = clean(record.url).toLowerCase();
  if (url) return `url:${url}`;
  return `title:${normalizeForHash(record.title)}:${record.year ?? ''}`;
}

function recordText(record: EvidenceItem): string {
  return [
    record.title,
    record.snippet,
    record.year,
    ...record.authors,
    ...Object.values(record.identifiers ?? {}),
    record.url,
  ].filter(Boolean).join(' ');
}

function isTrustedRecord(record: EvidenceItem): boolean {
  if (CONTEXT_ONLY_SOURCES.has(record.source)) return false;
  if (!TRUSTED_EVIDENCE_SOURCES.has(record.source)) return false;
  if (record.source === 'ctgov') return Boolean(record.identifiers?.nctId || record.identifiers?.nct || record.url);
  if (record.source === 'openalex') return Boolean(record.identifiers?.doi || record.url);
  return Boolean(record.identifiers?.pmid || record.identifiers?.doi || record.url);
}

function detectStudyDesign(record: EvidenceItem): string {
  const text = recordText(record).toLowerCase();
  if (record.source === 'ctgov') return 'clinical trial registry record';
  if (record.source === 'openfda') return 'regulatory safety context record';
  if (record.source === 'rxnorm') return 'drug terminology context record';
  if (/\b(meta-analysis|metaanalysis)\b/.test(text)) return 'meta-analysis';
  if (/\bsystematic review\b/.test(text)) return 'systematic review';
  if (/\brandomi[sz]ed\b|\brct\b/.test(text)) return 'randomized clinical trial';
  if (/\bclinical trial\b|\bphase\s+[1-4ivx]+\b/.test(text)) return 'clinical trial';
  if (/\bcohort\b/.test(text)) return 'cohort study';
  if (/\bcase[- ]control\b/.test(text)) return 'case-control study';
  if (/\bcross[- ]sectional\b/.test(text)) return 'cross-sectional study';
  if (/\bcase report\b/.test(text)) return 'case report';
  if (/\bcase series\b/.test(text)) return 'case series';
  if (/\bregistry\b/.test(text)) return 'registry study';
  if (/\breview\b/.test(text)) return 'narrative review';
  return 'indexed biomedical record';
}

function firstSentence(value: string, fallback: string): string {
  const sentence = clean(value).split(/(?<=[.!?])\s+/).find((part) => part.length > 24);
  return clean(sentence ?? fallback);
}

function detectPopulation(text: string): string {
  const candidate = clean(text).match(
    /\b(?:patients|participants|subjects|adults|children|women|men|individuals)\s+(?:with|receiving|undergoing|treated for|diagnosed with)\s+[^.;]{8,150}/i,
  )?.[0];
  return candidate ? clean(candidate) : 'not reported in retrieved record';
}

function detectExposure(record: EvidenceItem, text: string): string {
  if (record.source === 'openfda') return 'drug safety signal context';
  if (record.source === 'rxnorm') return 'drug identity and terminology context';
  const candidate = clean(text).match(
    /\b(?:intervention|exposure|treated with|receiving|therapy with|use of|effect of|association of)\s+[^.;]{8,150}/i,
  )?.[0];
  return candidate ? clean(candidate) : 'not reported in retrieved record';
}

function detectComparator(text: string): string {
  const candidate = clean(text).match(
    /\b(?:compared with|compared to|versus|vs\.?|control group|placebo|standard care)\s+[^.;]{4,120}/i,
  )?.[0];
  return candidate ? clean(candidate) : 'not reported in retrieved record';
}

function detectOutcomes(text: string): string[] {
  const outcomeRules: Array<[string, RegExp]> = [
    ['mortality', /\bmortality|death|survival\b/i],
    ['efficacy', /\befficacy|response|remission|improvement\b/i],
    ['safety', /\bsafety|adverse|harm|toxicity|bleeding|infection\b/i],
    ['pharmacokinetics', /\bpharmacokinetic|clearance|auc|cmax|half-life\b/i],
    ['clinical outcomes', /\boutcome|hospitali[sz]ation|complication\b/i],
    ['trial status or enrollment', /\benrolling|terminated|completed|recruiting\b/i],
  ];
  const outcomes = outcomeRules
    .filter(([, rx]) => rx.test(text))
    .map(([label]) => label);
  return [...new Set(outcomes)];
}

function extractSampleSize(text: string): string | null {
  const patterns = [
    /\b(?:n|N)\s*=\s*([0-9][0-9,]*)\b/,
    /\b([0-9][0-9,]*)\s+(?:patients|participants|subjects|adults|children|cases)\b/i,
    /\benrolled\s+([0-9][0-9,]*)\b/i,
    /\bsample\s+of\s+([0-9][0-9,]*)\b/i,
  ];
  for (const rx of patterns) {
    const match = text.match(rx);
    if (match?.[1]) return `n=${match[1].replace(/,/g, '')}`;
  }
  return null;
}

function extractEffectValues(text: string): ExtractedEffectValue[] {
  const effects: ExtractedEffectValue[] = [];
  const patterns: Array<{ label: string; rx: RegExp }> = [
    {
      label: 'odds ratio',
      rx: /\b(?:odds ratio|OR)\s*(?:=|of|:)?\s*([0-9]+(?:\.[0-9]+)?)(?:[^.;]{0,80}?(?:95%\s*CI\s*[:(]?\s*[0-9]+(?:\.[0-9]+)?\s*(?:-|to|,)\s*[0-9]+(?:\.[0-9]+)?\)?))?/gi,
    },
    {
      label: 'risk ratio',
      rx: /\b(?:risk ratio|relative risk|RR)\s*(?:=|of|:)?\s*([0-9]+(?:\.[0-9]+)?)(?:[^.;]{0,80}?(?:95%\s*CI\s*[:(]?\s*[0-9]+(?:\.[0-9]+)?\s*(?:-|to|,)\s*[0-9]+(?:\.[0-9]+)?\)?))?/gi,
    },
    {
      label: 'hazard ratio',
      rx: /\b(?:hazard ratio|HR)\s*(?:=|of|:)?\s*([0-9]+(?:\.[0-9]+)?)(?:[^.;]{0,80}?(?:95%\s*CI\s*[:(]?\s*[0-9]+(?:\.[0-9]+)?\s*(?:-|to|,)\s*[0-9]+(?:\.[0-9]+)?\)?))?/gi,
    },
    {
      label: 'confidence interval',
      rx: /\b95%\s*CI\s*[:(]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:-|to|,)\s*[0-9]+(?:\.[0-9]+)?)\)?/gi,
    },
    {
      label: 'p-value',
      rx: /\bp\s*(?:=|<|>)\s*(0?\.[0-9]+)/gi,
    },
  ];
  for (const { label, rx } of patterns) {
    for (const match of text.matchAll(rx)) {
      const sourceText = clean(match[0]);
      const value = clean(match[1] ?? match[0]);
      if (!value) continue;
      effects.push({ label, value, sourceText });
    }
  }
  const seen = new Set<string>();
  return effects.filter((effect) => {
    const key = `${effect.label}:${effect.value}:${effect.sourceText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function limitationsFor(record: EvidenceItem, extraction: Pick<EvidenceExtraction, 'studyDesign' | 'effectValues' | 'sampleSize'>): string[] {
  const limitations: string[] = [];
  if (!isTrustedRecord(record)) limitations.push('context-only source, not primary clinical evidence');
  if (!record.snippet || record.snippet.length < 80) limitations.push('limited abstract or snippet text available');
  if (!extraction.sampleSize) limitations.push('sample size not extracted from retrieved text');
  if (extraction.effectValues.length === 0) limitations.push('no extractable effect estimate or p-value in retrieved text');
  if (/review|meta-analysis/i.test(extraction.studyDesign)) limitations.push('secondary source; individual study data require source review');
  return limitations;
}

export function extractEvidenceFromRecords(records: EvidenceItem[]): EvidenceExtraction[] {
  return records.map((record, index) => {
    const text = recordText(record);
    const studyDesign = detectStudyDesign(record);
    const sampleSize = extractSampleSize(text);
    const effectValues = extractEffectValues(text);
    const partial = { studyDesign, sampleSize, effectValues };
    return {
      id: `extraction-${stableHash(`${index}:${sourceIdentity(record)}`)}`,
      sourceMarker: marker(index),
      evidenceIndex: index,
      source: record.source,
      title: clean(record.title) || 'Untitled source record',
      year: record.year === undefined || record.year === null ? null : String(record.year),
      identifiers: { ...(record.identifiers ?? {}) },
      studyDesign,
      population: detectPopulation(text),
      exposureOrIntervention: detectExposure(record, text),
      comparator: detectComparator(text),
      outcomes: detectOutcomes(text),
      sampleSize,
      effectValues,
      limitations: limitationsFor(record, partial),
      keyFinding: firstSentence(record.snippet ?? record.title, record.title),
      trusted: isTrustedRecord(record),
    };
  });
}

function numbers(value: string): string[] {
  return [...value.matchAll(/[0-9]+(?:\.[0-9]+)?/g)].map((match) => match[0]!.replace(/^0+(?=\d)/, ''));
}

function numberSupportedByRecord(value: string, record: EvidenceItem): boolean {
  const haystack = recordText(record).replace(/,/g, '');
  const haystackNumbers = new Set(numbers(haystack));
  return numbers(value).every((n) => haystackNumbers.has(n));
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? clean(value) : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => asString(item)).filter(Boolean) : [];
}

function asEffectValues(value: unknown): ExtractedEffectValue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const obj = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        label: asString(obj.label, 'reported statistic'),
        value: asString(obj.value),
        sourceText: asString(obj.sourceText ?? obj.source_text),
      };
    })
    .filter((effect) => effect.value && effect.sourceText);
}

export function parseEvidenceExtractionJson(
  json: string,
  record: EvidenceItem,
  evidenceIndex: number,
): EvidenceExtraction {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const effectValues = asEffectValues(parsed.effectValues ?? parsed.effect_values);
  for (const effect of effectValues) {
    if (!numberSupportedByRecord(`${effect.value} ${effect.sourceText}`, record)) {
      throw new Error(`Unsupported extracted statistic for ${marker(evidenceIndex)}: ${effect.value}`);
    }
  }
  const sampleSize = asString(parsed.sampleSize ?? parsed.sample_size) || extractSampleSize(recordText(record));
  if (sampleSize && !numberSupportedByRecord(sampleSize, record)) {
    throw new Error(`Unsupported extracted sample size for ${marker(evidenceIndex)}: ${sampleSize}`);
  }
  const studyDesign = asString(parsed.studyDesign ?? parsed.study_design, detectStudyDesign(record));
  const extraction = {
    id: `extraction-${stableHash(`${evidenceIndex}:${sourceIdentity(record)}:json`)}`,
    sourceMarker: marker(evidenceIndex),
    evidenceIndex,
    source: record.source,
    title: clean(record.title) || 'Untitled source record',
    year: record.year === undefined || record.year === null ? null : String(record.year),
    identifiers: { ...(record.identifiers ?? {}) },
    studyDesign,
    population: asString(parsed.population, detectPopulation(recordText(record))),
    exposureOrIntervention: asString(
      parsed.exposureOrIntervention ?? parsed.exposure_or_intervention,
      detectExposure(record, recordText(record)),
    ),
    comparator: asString(parsed.comparator, detectComparator(recordText(record))),
    outcomes: asStringArray(parsed.outcomes),
    sampleSize,
    effectValues,
    limitations: asStringArray(parsed.limitations),
    keyFinding: asString(parsed.keyFinding ?? parsed.key_finding, firstSentence(record.snippet ?? record.title, record.title)),
    trusted: isTrustedRecord(record),
  };
  return {
    ...extraction,
    limitations: extraction.limitations.length > 0 ? extraction.limitations : limitationsFor(record, extraction),
  };
}

function strengthFor(extraction: EvidenceExtraction): EvidenceStrength {
  if (!extraction.trusted) return 'context';
  if (/meta-analysis|systematic review|randomized clinical trial/i.test(extraction.studyDesign)) return 'strong';
  if (/clinical trial|cohort|case-control|registry/i.test(extraction.studyDesign)) return 'moderate';
  if (/indexed biomedical record|narrative review|cross-sectional|case series|case report/i.test(extraction.studyDesign)) {
    return 'weak';
  }
  return 'context';
}

function sectionForExtraction(extraction: EvidenceExtraction): string {
  // Registry records describe themselves as a "clinical trial registry record",
  // which matches the Clinical section's "clinical" before the Trial section's
  // "trial" in the keyword sweep below — so route them explicitly first, or the
  // Trial and Registry section is never genuinely populated.
  if (extraction.source === 'ctgov' || /\bregistry\b/i.test(extraction.studyDesign)) {
    return 'Trial and Registry Evidence';
  }
  const text = [
    extraction.title,
    extraction.studyDesign,
    extraction.keyFinding,
    extraction.outcomes.join(' '),
    extraction.exposureOrIntervention,
  ].join(' ');
  for (const candidate of SECTION_KEYWORDS) {
    if (candidate.terms.some((rx) => rx.test(text))) return candidate.section;
  }
  return 'Evidence Base and Search Yield';
}

function claimForExtraction(extraction: EvidenceExtraction): string {
  const finding = clean(extraction.keyFinding || extraction.title);
  const design = extraction.studyDesign === 'indexed biomedical record' ? 'record' : extraction.studyDesign;
  return `${extraction.sourceMarker} ${design} evidence reports: ${finding}`;
}

export function buildClaimLedger(extractions: EvidenceExtraction[]): ClaimLedgerEntry[] {
  const byClaim = new Map<string, ClaimLedgerEntry>();
  for (const extraction of extractions) {
    const claim = claimForExtraction(extraction);
    const key = normalizeForHash(`${sectionForExtraction(extraction)}:${claim.replace(/\[S\d+\]\s*/, '')}`);
    const existing = byClaim.get(key);
    const numericSupport = [
      extraction.sampleSize ?? '',
      ...extraction.effectValues.map((effect) => `${effect.label} ${effect.value}`),
    ].filter(Boolean);
    if (existing) {
      existing.supportingSources = [...new Set([...existing.supportingSources, extraction.sourceMarker])];
      existing.numericSupport = [...new Set([...existing.numericSupport, ...numericSupport])];
      existing.contradictionNotes = [...new Set([...existing.contradictionNotes, ...extraction.limitations])];
      if (existing.evidenceStrength === 'context' && strengthFor(extraction) !== 'context') {
        existing.evidenceStrength = strengthFor(extraction);
      }
      continue;
    }
    const id = `claim-${byClaim.size + 1}`;
    byClaim.set(key, {
      id,
      claim,
      supportingSources: [extraction.sourceMarker],
      sectionTarget: sectionForExtraction(extraction),
      evidenceStrength: strengthFor(extraction),
      contradictionNotes: [...extraction.limitations],
      numericSupport,
    });
  }
  return [...byClaim.values()];
}

export function titleTopic(question: string): string {
  const subject = stripTrailingMeta(stripLeadingMeta(question)).replace(/\s+/g, ' ').trim();
  return fixTypos(subject || question.trim());
}

function blueprintTitle(question: string): string {
  const topic = titleTopic(question);
  if (!topic) return 'Evidence Review of the Requested Biomedical Question';
  // Strip leading article ("a", "an", "the") that survived question parsing.
  const cleaned = topic.replace(/^(a|an|the)\s+/i, '').trim();
  const titled = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  // When the topic is already a proper study or manuscript title (contains
  // study-design terminology), use it directly rather than prepending a label.
  if (/\b(study|trial|analysis|review|survey|cohort|cross[-\s]?sectional|randomized|randomised|assessment|evaluation|investigation|report|examination)\b/i.test(titled)) {
    return titled;
  }
  return `Evidence Review: ${titled}`;
}

function claimIdsForSection(section: SectionSpec, ledger: ClaimLedgerEntry[]): string[] {
  const direct = ledger.filter((entry) => entry.sectionTarget === section.heading);
  if (direct.length > 0) return direct.slice(0, MAX_LEDGER_CLAIMS_PER_SECTION).map((entry) => entry.id);

  if (section.heading === 'Introduction' || section.heading === 'Discussion' || section.heading === 'Conclusion') {
    return ledger.slice(0, MAX_LEDGER_CLAIMS_PER_SECTION).map((entry) => entry.id);
  }
  if (section.heading === 'Methods' || section.heading === 'Limitations') {
    return ledger.slice(0, Math.min(8, ledger.length)).map((entry) => entry.id);
  }
  return ledger.filter((entry) => entry.evidenceStrength !== 'context').slice(0, 8).map((entry) => entry.id);
}

// Brain Mini's reduced section set — a coherent shorter paper (about half the
// drafting calls of the full plan) for low-quota / small local models.
const MINI_SECTION_HEADINGS = new Set([
  'Introduction',
  'Methods',
  'Evidence Base and Search Yield',
  'Discussion',
  'Conclusion',
  'Declarations',
]);

// Topic-specific sections that must be earned by evidence. If the retrieval
// produced no claim that actually targets one of these, the section is dropped
// rather than padded with unrelated claims — which is how a pharmacology-free
// asthma-education topic ended up with a fabricated PK/PD section the model
// "supported" with citations to pharmacist-intervention papers.
const EVIDENCE_GATED_HEADINGS = new Set([
  'Mechanistic and Pharmacologic Evidence',
  'Trial and Registry Evidence',
]);

export function buildPaperBlueprint(
  question: string,
  ledger: ClaimLedgerEntry[],
  overrideTitle?: string,
  mini = false,
): PaperBlueprint {
  const basePlan = mini ? SECTION_PLAN.filter((section) => MINI_SECTION_HEADINGS.has(section.heading)) : SECTION_PLAN;
  // Drop an evidence-gated section when no claim genuinely targets it, so the
  // model is never asked to write (and fabricate citations for) a section the
  // retrieval did not support.
  const plan = basePlan.filter(
    (section) =>
      !EVIDENCE_GATED_HEADINGS.has(section.heading) ||
      ledger.some(
        (entry) => entry.sectionTarget === section.heading && entry.evidenceStrength !== 'context',
      ),
  );
  return {
    title: overrideTitle ?? blueprintTitle(question),
    abstractIntent:
      'Structured evidence-review abstract summarizing the automated search, source-backed findings, evidence strength, limitations, and clinical/research implications without unsupported statistics.',
    sections: plan.map((section) => {
      const requiredClaimIds = claimIdsForSection(section, ledger);
      const requiredSourceMarkers = [
        ...new Set(
          requiredClaimIds.flatMap((id) => ledger.find((entry) => entry.id === id)?.supportingSources ?? []),
        ),
      ];
      return {
        heading: section.heading,
        intent: section.instruction,
        requiredClaimIds,
        requiredSourceMarkers,
        targetWords: section.targetWords,
        minWords: section.minWords,
      };
    }),
    requiredTables: [
      'evidence extraction table',
      'claim ledger',
      'search/source-yield statistics',
      'evidence-strength counts',
      'extracted numeric-statistics table when source text contains numeric statistics',
    ],
    requiredFigures: ['source-yield figure', 'automated evidence-flow figure', 'evidence-year figure when dates are available'],
  };
}

export interface PaperOutline {
  title: string;
  sections: { heading: string; intent: string; targetWords: string }[];
}

/**
 * The section plan a paper WILL follow, derived deterministically (no model
 * call, no tokens) so the user can preview and steer scope before committing to
 * a full drafting run. `intent` is a one-line summary of each section's job.
 */
export function buildPaperOutline(question: string, mini = false): PaperOutline {
  const plan = mini ? SECTION_PLAN.filter((section) => MINI_SECTION_HEADINGS.has(section.heading)) : SECTION_PLAN;
  return {
    title: blueprintTitle(question),
    sections: plan.map((section) => {
      const firstSentence = section.instruction.split(/(?<=[.!?])\s/)[0] ?? section.instruction;
      return {
        heading: section.heading,
        intent: firstSentence.trim().slice(0, 180),
        targetWords: section.targetWords,
      };
    }),
  };
}

// Keywords are drawn from the SUBJECT (instruction words stripped), with typos
// corrected and instruction/deliverable words excluded — so a request like
// "make a full reaserch paper about ..." yields the actual topic terms, never
// "full" or "reaserch".
// Generic academic connective nouns that carry no indexing value on their own
// — dropped so the keyword list reads as real subject terms ("asthma",
// "pharmacist", "inhaler") rather than "role" / "approach" / "use".
const GENERIC_KEYWORDS = new Set([
  'role', 'roles', 'approach', 'approaches', 'overview', 'use', 'uses', 'using',
  'toward', 'towards', 'various', 'based', 'study', 'studies', 'paper', 'report',
  'general', 'related', 'among', 'within',
]);

export function keywordsFrom(question: string): string[] {
  return [
    ...new Set(
      titleTopic(question)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((word) => TYPO_FIXES[word] ?? word)
        .filter(
          (word) =>
            word.length >= 4 &&
            !STOPWORDS.has(word) &&
            !META_INSTRUCTION_WORDS.has(word) &&
            !GENERIC_KEYWORDS.has(word),
        ),
    ),
  ].slice(0, 8);
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length;
}

function bodyWordCount(body: string[]): number {
  return wordCount(body.join(' '));
}

function issue(severity: ValidationIssue['severity'], code: string, message: string, section?: string): ValidationIssue {
  return {
    severity,
    code,
    message,
    ...(section ? { section } : {}),
  };
}

function citedSourceMarkers(text: string): string[] {
  return [...text.matchAll(/\[S(\d+)\]/g)].map((match) => `[S${match[1]}]`);
}

function manuscriptText(manuscript: Manuscript): string {
  return [
    manuscript.title,
    ...Object.values(manuscript.abstract),
    ...manuscript.sections.flatMap((section) => [section.heading, ...section.body]),
  ].join('\n\n');
}

function sectionText(manuscript: Manuscript, heading: string): string {
  return manuscript.sections.find((section) => section.heading === heading)?.body.join(' ') ?? '';
}

export function validatePaperPackage(opts: {
  manuscript?: Manuscript;
  evidenceExtractions: EvidenceExtraction[];
  claimLedger: ClaimLedgerEntry[];
  paperBlueprint: PaperBlueprint;
}): PaperPackageQa {
  const blockers: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const trustedEvidence = opts.evidenceExtractions.filter((item) => item.trusted);
  const primaryEvidence = trustedEvidence.filter((item) => !CONTEXT_ONLY_SOURCES.has(item.source));
  const numericCount = opts.evidenceExtractions.reduce(
    (sum, item) => sum + item.effectValues.length + (item.sampleSize ? 1 : 0),
    0,
  );
  const effectCount = opts.evidenceExtractions.reduce((sum, item) => sum + item.effectValues.length, 0);
  const nonContextClaims = opts.claimLedger.filter((entry) => entry.evidenceStrength !== 'context');

  if (opts.evidenceExtractions.length === 0) {
    blockers.push(issue('blocker', 'no-evidence-extractions', 'No trusted records were retrieved for extraction.'));
  }
  if (opts.claimLedger.length === 0) {
    blockers.push(issue('blocker', 'empty-claim-ledger', 'No source-backed claim ledger could be built.'));
  }
  if (primaryEvidence.length < MIN_PRIMARY_EVIDENCE) {
    blockers.push(
      issue(
        'blocker',
        'insufficient-trusted-evidence',
        `Only ${primaryEvidence.length} trusted primary evidence record(s) were available; a publishable automated evidence-review draft requires at least ${MIN_PRIMARY_EVIDENCE} source-backed records.`,
      ),
    );
  }
  const distinctPrimarySources = new Set(primaryEvidence.map((item) => item.source)).size;
  if (primaryEvidence.length >= MIN_PRIMARY_EVIDENCE && distinctPrimarySources < 2) {
    warnings.push(
      issue(
        'warning',
        'single-source-evidence-base',
        `All primary evidence came from a single database (${distinctPrimarySources} distinct source); corroboration across independent databases would strengthen the review.`,
      ),
    );
  }
  if (nonContextClaims.length === 0) {
    blockers.push(issue('blocker', 'no-primary-claims', 'The ledger contains no primary source-backed evidence claims.'));
  }
  if (effectCount === 0) {
    warnings.push(
      issue(
        'warning',
        'no-extracted-effect-statistics',
        'No sample sizes, effect estimates, confidence intervals, or p-values were extractable from source text; statistics are limited to source-yield and evidence-strength counts.',
      ),
    );
  }
  if (!opts.claimLedger.some((entry) => entry.sectionTarget === 'Clinical Evidence and Safety Outcomes')) {
    blockers.push(
      issue(
        'blocker',
        'no-source-backed-results',
        'The Results-equivalent clinical evidence section has no source-backed finding in the claim ledger.',
        'Clinical Evidence and Safety Outcomes',
      ),
    );
  }
  if (!opts.claimLedger.some((entry) => entry.sectionTarget === 'Trial and Registry Evidence')) {
    warnings.push(
      issue(
        'warning',
        'no-trial-registry-claims',
        'No clinical-trial or registry claim was found; the trial section must transparently describe the evidence gap.',
        'Trial and Registry Evidence',
      ),
    );
  }

  for (const section of opts.paperBlueprint.sections) {
    if (section.heading !== 'Declarations' && section.requiredClaimIds.length === 0) {
      warnings.push(
        issue(
          'warning',
          'blueprint-section-without-direct-claims',
          `${section.heading} has no direct section-specific claim and will use the broader ledger with explicit limitations.`,
          section.heading,
        ),
      );
    }
  }

  if (opts.manuscript) {
    const approvedMarkers = new Set(opts.claimLedger.flatMap((entry) => entry.supportingSources));
    for (const cited of citedSourceMarkers(manuscriptText(opts.manuscript))) {
      if (!approvedMarkers.has(cited)) {
        blockers.push(
          issue('blocker', 'citation-not-in-claim-ledger', `${cited} is cited but not present in the approved claim ledger.`),
        );
      }
    }
    const clinical = sectionText(opts.manuscript, 'Clinical Evidence and Safety Outcomes');
    if (!/\[S\d+\]/.test(clinical)) {
      blockers.push(
        issue(
          'blocker',
          'clinical-results-uncited',
          'The Results-equivalent clinical evidence section contains no source-backed inline citation.',
          'Clinical Evidence and Safety Outcomes',
        ),
      );
    }
    const body = opts.manuscript.sections.map((section) => section.body.join(' ')).join(' ').toLowerCase();
    const abstract = Object.values(opts.manuscript.abstract).join(' ').toLowerCase();
    if (/\b(definitive|conclusive|proven|rules out|establishes safety)\b/.test(abstract) && /\b(limited|thin|insufficient|indirect|gap)\b/.test(body)) {
      blockers.push(
        issue(
          'blocker',
          'abstract-overstates-body',
          'The abstract uses strong certainty language while the body describes limited or indirect evidence.',
        ),
      );
    }
  }

  const exportReady = blockers.length === 0;
  return {
    stage: exportReady ? 'export_ready' : 'blocked',
    exportReady,
    blockers,
    warnings,
    summary: [
      `${trustedEvidence.length} trusted record(s) extracted`,
      `${opts.claimLedger.length} source-backed claim(s) built`,
      `${numericCount} extracted numeric statistic(s) or sample-size field(s)`,
      exportReady ? 'Export gate passed' : 'Export gate blocked',
    ],
  };
}

function ledgerById(ledger: ClaimLedgerEntry[]): Map<string, ClaimLedgerEntry> {
  return new Map(ledger.map((entry) => [entry.id, entry]));
}

function claimsForBlueprintSection(section: PaperBlueprint['sections'][number], ledger: ClaimLedgerEntry[]): ClaimLedgerEntry[] {
  const byId = ledgerById(ledger);
  const direct = section.requiredClaimIds.map((id) => byId.get(id)).filter((entry): entry is ClaimLedgerEntry => Boolean(entry));
  if (direct.length > 0) return direct;
  return ledger.slice(0, Math.min(MAX_LEDGER_CLAIMS_PER_SECTION, ledger.length));
}

function formatClaim(entry: ClaimLedgerEntry): string {
  const numeric = entry.numericSupport.length > 0 ? ` Numeric support: ${entry.numericSupport.join('; ')}.` : '';
  const limits = entry.contradictionNotes.length > 0 ? ` Limits: ${entry.contradictionNotes.join('; ')}.` : '';
  return `${entry.id} (${entry.evidenceStrength}; ${entry.sectionTarget}; sources ${entry.supportingSources.join(', ')}): ${entry.claim}${numeric}${limits}`;
}

function formatExtraction(extraction: EvidenceExtraction): string {
  const ids = Object.entries(extraction.identifiers)
    .map(([key, value]) => `${key}:${value}`)
    .join(', ');
  const numeric = [
    extraction.sampleSize ?? '',
    ...extraction.effectValues.map((effect) => `${effect.label} ${effect.value} (${effect.sourceText})`),
  ].filter(Boolean).join('; ');
  return [
    `${extraction.sourceMarker} ${extraction.source.toUpperCase()} ${extraction.year ?? 'year not reported'} ${extraction.title}`,
    `Identifiers: ${ids || 'not available'}`,
    `Design: ${extraction.studyDesign}`,
    `Population: ${extraction.population}`,
    `Exposure/intervention: ${extraction.exposureOrIntervention}`,
    `Comparator: ${extraction.comparator}`,
    `Outcomes: ${extraction.outcomes.join(', ') || 'not reported'}`,
    `Numeric support: ${numeric || 'none extracted'}`,
    `Key finding: ${extraction.keyFinding}`,
    `Limits: ${extraction.limitations.join('; ') || 'none recorded'}`,
  ].join(' | ');
}

function sourceYieldBlock(extractions: EvidenceExtraction[]): string {
  const counts = new Map<string, number>();
  for (const item of extractions) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => `${source}: ${count}`).join(', ');
}

function specialistRoleDigest(specialists: SpecialistResult[]): string {
  const usable = specialists.filter((specialist) => specialist.evidence.length > 0 || specialist.findings.trim());
  if (usable.length === 0) return 'No specialist role summaries were available beyond retrieved source records.';
  return usable
    .map(
      (specialist) =>
        `${specialist.label}: ${specialist.evidence.length} retrieved record(s). ${clean(specialist.findings).slice(0, 420)}`,
    )
    .join('\n');
}

// A provider rejecting the request because the prompt is too big for the
// model's CONTEXT WINDOW (HTTP 413 / "request too large" / "context length").
// When the failover chain lands on a small-budget model (e.g. gpt-oss-120b at
// 8k), a full section prompt overflows; we recover by shrinking it. NOTE: a
// "tokens per minute" message is a RATE limit, not a context-size error —
// shrinking cannot fix a per-minute quota, so it is classified separately below.
function isCallTooLarge(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes('413') ||
    m.includes('request too large') ||
    m.includes('context length') ||
    m.includes('context_length') ||
    m.includes('too many tokens') ||
    m.includes('maximum context')
  );
}

// A rate / quota limit (per-minute requests or tokens, daily quota, cooldown).
// Shrinking does not help; a brief backoff (the failover chain has already
// tried every provider) gives a cooling key time to recover.
function isCallRateLimited(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('rate_limit') ||
    m.includes('quota') ||
    m.includes('requests per minute') ||
    m.includes('tokens per minute') ||
    m.includes('too many requests') ||
    m.includes('cooling down') ||
    m.includes('cooldown')
  );
}

const MIN_CALL_CHARS = 4_000;
const MAX_CALL_RATE_RETRIES = 3;

function callSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callModel(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  noPause = false,
): Promise<string> {
  // Surface a silent boss-model failover in the trace so a mid-run provider
  // outage is visible rather than only changing the model label afterwards.
  const onProgress = (progress: { to: { shortLabel: string }; reason: string }) => {
    bus.emit('agent:activity', {
      agentId: 'boss',
      phase: 'tool_call',
      detail: `model unavailable — switched to ${progress.to.shortLabel} (${progress.reason.slice(0, 80)})`,
    });
  };

  let content = user;
  let tokenCap = maxTokens;
  let rateRetries = 0;
  for (;;) {
    try {
      const response = await completeWithModelChain(
        model,
        {
          messages: [
            { role: 'system', content: system },
            { role: 'user', content },
          ],
          temperature: 0.22,
          maxTokens: tokenCap,
        },
        onProgress,
      );
      return response.content.trim();
    } catch (err) {
      if (isCallTooLarge(err) && content.length > MIN_CALL_CHARS) {
        content = content.slice(0, Math.max(MIN_CALL_CHARS, Math.floor(content.length / 2)));
        tokenCap = Math.min(tokenCap, 1500);
        bus.emit('agent:activity', {
          agentId: 'boss',
          phase: 'tool_call',
          detail: `section prompt too large — retrying smaller (${content.length} chars)`,
        });
        continue;
      }
      // Brain Mini deliberately does NOT pause on rate limits — it fails fast
      // (the section gets flagged) so a low-quota run never stalls in backoff.
      if (isCallRateLimited(err) && !noPause && rateRetries < MAX_CALL_RATE_RETRIES) {
        rateRetries += 1;
        const waitMs = Math.min(8_000, 1_000 * 2 ** (rateRetries - 1)) + Math.floor(Math.random() * 400);
        bus.emit('agent:activity', {
          agentId: 'boss',
          phase: 'tool_call',
          detail: `rate-limited — pausing ${Math.round(waitMs / 1000)}s before retry`,
        });
        await callSleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

async function draftLedgerSection(opts: {
  model: string;
  question: string;
  section: PaperBlueprint['sections'][number];
  claims: ClaimLedgerEntry[];
  extractions: EvidenceExtraction[];
  specialistDigest: string;
  datasetBlock: string;
  priorDigest: string;
  currentBody?: string[];
  evidenceGap?: string;
  mini?: boolean;
}): Promise<string[]> {
  const sourceMarkers = new Set(opts.claims.flatMap((claim) => claim.supportingSources));
  const relevantExtractions = opts.extractions.filter((item) => sourceMarkers.has(item.sourceMarker));
  const claimsBlock = opts.claims.map(formatClaim).join('\n');
  const extractionBlock = relevantExtractions.map(formatExtraction).join('\n');
  const current = opts.currentBody?.length ? `\nCurrent draft to repair:\n${opts.currentBody.join('\n\n')}\n` : '';
  const gapNote = opts.evidenceGap ? `\nEVIDENCE GAP — MANDATORY HONESTY:\n${opts.evidenceGap}\n` : '';
  const userPrompt = `Manuscript topic: ${opts.question}
${gapNote}

Pipeline stage: claim-led manuscript drafting.
Section to write now: ${opts.section.heading}
Section intent: ${opts.section.intent}
Target length: ${opts.section.targetWords}
Minimum words: ${opts.section.minWords}
Approved source markers for this section: ${[...sourceMarkers].join(', ') || '(none)'}

Approved claim ledger entries:
${claimsBlock || 'No direct claims were assigned. Write only a transparent evidence-gap section using the broader source-yield context.'}

Evidence extraction rows for approved markers:
${extractionBlock || 'No direct extraction rows were assigned.'}

Source-yield statistics:
${sourceYieldBlock(opts.extractions)}

Agent role digest:
${opts.specialistDigest}

Uploaded dataset statistics, if supplied:
${opts.datasetBlock}

Previously drafted sections for continuity:
${opts.priorDigest}
${current}
Write the ${opts.section.heading} section now. Start immediately with the first sentence — no heading, no number, no title. Write to the UPPER end of the target range (${opts.section.targetWords}); a thorough section is better than a brief one. Every factual sentence must be traceable to the claim ledger or extraction rows. Develop every point fully across multiple sentences — do not reduce findings to brief statements. If no effect sizes are extracted, state clearly that quantitative statistics are limited to source-yield and evidence-strength counts, then compensate with rich contextual discussion.`;
  const reply = await callModel(
    opts.model,
    SECTION_SYSTEM,
    userPrompt,
    opts.mini ? MINI_SECTION_TOKENS : SECTION_TOKENS,
    opts.mini ?? false,
  );

  // Reject replies that look like the model wrote a complete document instead of
  // one section — salvage what we can or fall back to a gap section.
  if (looksLikeWholeDocument(reply)) {
    const salvaged = extractSectionFromDocument(reply, opts.section.heading);
    if (salvaged) {
      return sectionBodyFromReply(opts.section.heading, salvaged);
    }
    // Cannot salvage — return a flagged gap section body directly
    return [
      `${SECTION_REVIEW_FLAG} the language model produced a complete-document structure instead of the requested ${opts.section.heading.toLowerCase()} section, so this section needs to be regenerated before submission. The claim ledger and extraction table should be reviewed directly ${[...sourceMarkers].slice(0, 3).join(' ')}.`,
    ];
  }

  return sectionBodyFromReply(opts.section.heading, reply);
}

function declarationSection(): ManuscriptSection {
  return {
    heading: 'Declarations',
    body: [
      'This manuscript is an automated evidence-review draft generated from public biomedical databases and structured source extraction. No specific funding or conflicts of interest were supplied. The draft is intended for expert review, journal-specific editing, and source verification before any clinical, regulatory, or publication use, and it is not medical advice.',
    ],
  };
}

function deterministicGapSection(section: PaperBlueprint['sections'][number], sourceMarkers: string[]): ManuscriptSection {
  const cited = sourceMarkers.slice(0, 3).join(' ') || '[S1]';
  return {
    heading: section.heading,
    body: [
      `The automated evidence pipeline did not identify enough section-specific source-backed claims to support a full ${section.heading.toLowerCase()} synthesis. The available retrieval set is therefore handled as evidence-gap context rather than as proof of an effect. Any interpretation in this section should be restricted to the retrieved source-yield and claim-led evidence tables ${cited}.`,
      `This limitation is important for publication readiness: the draft should not imply direct clinical certainty, pooled efficacy, safety equivalence, or causal inference when the claim ledger lacks section-specific primary evidence ${cited}. Additional targeted searches, full-text review, and expert screening would be required before strengthening the conclusion.`,
    ],
  };
}

async function compileSections(opts: {
  question: string;
  bossModel: string;
  specialists: SpecialistResult[];
  extractions: EvidenceExtraction[];
  claimLedger: ClaimLedgerEntry[];
  paperBlueprint: PaperBlueprint;
  dataset?: UploadedDatasetSummary | null;
  onStage?: (stage: string) => void;
  repairTargets?: Map<string, string[]>;
  existingSections?: ManuscriptSection[];
  evidenceGap?: string;
  mini?: boolean;
}): Promise<ManuscriptSection[]> {
  const sections: ManuscriptSection[] = [];
  const roleDigest = specialistRoleDigest(opts.specialists);
  const datasetBlock = opts.dataset ? datasetSummaryForPrompt(opts.dataset) : '(no uploaded dataset was supplied)';

  for (const blueprintSection of opts.paperBlueprint.sections) {
    if (opts.repairTargets && !opts.repairTargets.has(blueprintSection.heading)) {
      const existing = opts.existingSections?.find((section) => section.heading === blueprintSection.heading);
      if (existing) {
        sections.push(existing);
        continue;
      }
    }
    if (blueprintSection.heading === 'Declarations') {
      sections.push(declarationSection());
      continue;
    }
    opts.onStage?.(opts.repairTargets?.has(blueprintSection.heading) ? `QA repair ${blueprintSection.heading}` : blueprintSection.heading);
    const claims = claimsForBlueprintSection(blueprintSection, opts.claimLedger);
    const assignedMarkers = [...new Set(claims.flatMap((claim) => claim.supportingSources))];
    if (claims.length === 0) {
      sections.push(deterministicGapSection(blueprintSection, opts.extractions.map((item) => item.sourceMarker)));
      continue;
    }
    const priorDigest =
      sections.map((section) => `${section.heading}: ${(section.body[0] ?? '').slice(0, 220)}`).join('\n') ||
      '(none yet)';
    const existing = opts.existingSections?.find((section) => section.heading === blueprintSection.heading);
    let body: string[];
    try {
      body = await draftLedgerSection({
        model: opts.bossModel,
        question: opts.question,
        section: blueprintSection,
        claims,
        extractions: opts.extractions,
        specialistDigest: roleDigest,
        datasetBlock,
        priorDigest,
        ...(existing ? { currentBody: existing.body } : {}),
        ...(opts.evidenceGap ? { evidenceGap: opts.evidenceGap } : {}),
        mini: opts.mini ?? false,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Surface the failure in the trace instead of silently shipping a stub
      // section — this is what made an incomplete paper look like a success.
      bus.emit('agent:activity', {
        agentId: 'boss',
        phase: 'error',
        detail: `Section "${blueprintSection.heading}" draft failed: ${detail.slice(0, 120)}`,
      });
      body = [
        `${SECTION_REVIEW_FLAG} this section could not be drafted from the claim ledger because the language-model call failed (${detail.slice(0, 160)}). It needs to be written or regenerated before submission. The available claim ledger should be reviewed directly ${assignedMarkers.slice(0, 3).join(' ')}.`,
      ];
    }

    let passes = 1;
    while (bodyWordCount(body) < blueprintSection.minWords && passes < MAX_SECTION_PASSES) {
      opts.onStage?.(`${blueprintSection.heading} expansion ${passes}`);
      try {
        body = await draftLedgerSection({
          model: opts.bossModel,
          question: opts.question,
          section: blueprintSection,
          claims,
          extractions: opts.extractions,
          specialistDigest: roleDigest,
          datasetBlock,
          priorDigest,
          currentBody: body,
          ...(opts.evidenceGap ? { evidenceGap: opts.evidenceGap } : {}),
          mini: opts.mini ?? false,
        });
      } catch {
        break;
      }
      passes += 1;
    }
    sections.push({ heading: blueprintSection.heading, body });
  }
  return sections;
}

async function draftAbstract(opts: {
  model: string;
  title: string;
  sections: ManuscriptSection[];
  claimLedger: ClaimLedgerEntry[];
  extractions: EvidenceExtraction[];
}): Promise<Manuscript['abstract']> {
  const strong = opts.claimLedger.filter((claim) => claim.evidenceStrength === 'strong').length;
  const moderate = opts.claimLedger.filter((claim) => claim.evidenceStrength === 'moderate').length;
  const weak = opts.claimLedger.filter((claim) => claim.evidenceStrength === 'weak').length;
  const context = opts.claimLedger.filter((claim) => claim.evidenceStrength === 'context').length;
  const numeric = opts.extractions.reduce((sum, item) => sum + item.effectValues.length + (item.sampleSize ? 1 : 0), 0);
  const digest = opts.sections.map((section) => `${section.heading}\n${section.body.join(' ')}`).join('\n\n').slice(0, 7000);
  try {
    const reply = await callModel(
      opts.model,
      'You write structured scientific abstracts for source-grounded biomedical AUTOMATED EVIDENCE REVIEWS. Reply with exactly five labelled fields: Background:, Objective:, Methods:, Results:, Conclusions:. Do not add references or unsupported statistics. CRITICAL: this is a review of retrieved published literature, not an original study. The Methods field must describe ONLY the automated literature search and synthesis — never claim a cohort was studied, patients were enrolled, electronic health records or propensity-score matching were used, or that you measured any outcome. The Results field reports what the retrieved sources found, never results you produced.',
      `Write a structured abstract for "${opts.title}" using only this manuscript body and these app-owned statistics. This is an automated evidence review; do not invent a study design or primary data.

Evidence-strength counts: strong ${strong}, moderate ${moderate}, weak ${weak}, context ${context}.
Extracted numeric statistic/sample-size fields: ${numeric}.

Manuscript body:
${digest}`,
      1200,
    );
    return parseAbstract(reply);
  } catch {
    return {
      background: 'This evidence-review draft was generated from guarded biomedical source retrieval and structured extraction.',
      objective: `To summarize source-backed evidence for ${opts.title.replace(/^Evidence Review of\s+/i, '')}.`,
      methods: `The pipeline extracted ${opts.extractions.length} retrieved record(s), built ${opts.claimLedger.length} claim-led entry or entries, and blocked unsupported statistics.`,
      results: `The claim ledger included ${strong} strong, ${moderate} moderate, ${weak} weak, and ${context} context claim(s); ${numeric} numeric statistic or sample-size field(s) were extracted from source text.`,
      conclusions: 'The draft should be reviewed against full source records before submission or clinical use.',
    };
  }
}

function repairableSectionNames(issues: ValidationIssue[]): string[] {
  const names = issues
    .filter((issueItem) =>
      issueItem.section &&
      ['section-too-short', 'section-missing-citation', 'unsupported-statistic', 'clinical-results-uncited'].includes(issueItem.code),
    )
    .map((issueItem) => issueItem.section!);
  return [...new Set(names)].slice(0, MAX_QA_REPAIR_SECTIONS);
}

// Build the publication artifact without letting an exception abort assembly.
// On failure the manuscript is still returned (its readable text renders in
// chat); only the structured artifact — figures, canonical references — is
// dropped. The outer pipeline and BrainMode catch any further failure.
function safePublicationArtifact(
  manuscript: Manuscript,
  evidence: EvidenceItem[],
  options: Parameters<typeof buildPublicationArtifact>[2],
): ReturnType<typeof buildPublicationArtifact> | undefined {
  try {
    return buildPublicationArtifact(manuscript, evidence, options);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('publication artifact build failed; returning manuscript without it', error);
    return undefined;
  }
}

export async function compileManuscriptFromLedger(opts: {
  question: string;
  bossModel: string;
  specialists: SpecialistResult[];
  evidence: EvidenceItem[];
  evidenceExtractions: EvidenceExtraction[];
  claimLedger: ClaimLedgerEntry[];
  paperBlueprint: PaperBlueprint;
  standard?: ManuscriptStandard;
  dataset?: UploadedDatasetSummary | null;
  onStage?: (stage: string) => void;
  evidenceGap?: string;
  mini?: boolean;
}): Promise<Manuscript> {
  opts.onStage?.('Drafting');
  let sections = await compileSections({
    question: opts.question,
    bossModel: opts.bossModel,
    specialists: opts.specialists,
    extractions: opts.evidenceExtractions,
    claimLedger: opts.claimLedger,
    paperBlueprint: opts.paperBlueprint,
    ...(opts.dataset ? { dataset: opts.dataset } : {}),
    ...(opts.evidenceGap ? { evidenceGap: opts.evidenceGap } : {}),
    mini: opts.mini ?? false,
    ...(opts.onStage ? { onStage: opts.onStage } : {}),
  });
  let abstract = await draftAbstract({
    model: opts.bossModel,
    title: opts.paperBlueprint.title,
    sections,
    claimLedger: opts.claimLedger,
    extractions: opts.evidenceExtractions,
  });
  let manuscript: Manuscript = {
    title: opts.paperBlueprint.title,
    abstract,
    keywords: keywordsFrom(opts.question),
    sections,
  };
  let qa = validatePaperPackage({
    manuscript,
    evidenceExtractions: opts.evidenceExtractions,
    claimLedger: opts.claimLedger,
    paperBlueprint: opts.paperBlueprint,
  });
  const firstArtifact = safePublicationArtifact(manuscript, opts.evidence, {
    standard: opts.standard ?? 'icmje_generic',
    ...(opts.dataset ? { dataset: opts.dataset } : {}),
    evidenceExtractions: opts.evidenceExtractions,
    claimLedger: opts.claimLedger,
    paperBlueprint: opts.paperBlueprint,
    paperQa: qa,
  });
  manuscript = {
    ...manuscript,
    ...(firstArtifact ? { publication: firstArtifact } : {}),
  };

  const repairTargets = repairableSectionNames(manuscript.publication?.validation.blockers ?? []);
  if (repairTargets.length > 0) {
    opts.onStage?.('QA repair');
    const sectionMap = new Map<string, string[]>(repairTargets.map((heading) => [heading, []]));
    const repaired = await compileSections({
      question: opts.question,
      bossModel: opts.bossModel,
      specialists: opts.specialists,
      extractions: opts.evidenceExtractions,
      claimLedger: opts.claimLedger,
      paperBlueprint: opts.paperBlueprint,
      ...(opts.dataset ? { dataset: opts.dataset } : {}),
      ...(opts.evidenceGap ? { evidenceGap: opts.evidenceGap } : {}),
      mini: opts.mini ?? false,
      ...(opts.onStage ? { onStage: opts.onStage } : {}),
      repairTargets: sectionMap,
      existingSections: sections,
    });
    const repairedNames = new Set(repairTargets);
    sections = sections.map((section) => repairedNames.has(section.heading) ? repaired.find((candidate) => candidate.heading === section.heading) ?? section : section);
    abstract = await draftAbstract({
      model: opts.bossModel,
      title: opts.paperBlueprint.title,
      sections,
      claimLedger: opts.claimLedger,
      extractions: opts.evidenceExtractions,
    });
    manuscript = {
      title: opts.paperBlueprint.title,
      abstract,
      keywords: keywordsFrom(opts.question),
      sections,
    };
    qa = validatePaperPackage({
      manuscript,
      evidenceExtractions: opts.evidenceExtractions,
      claimLedger: opts.claimLedger,
      paperBlueprint: opts.paperBlueprint,
    });
    const repairedArtifact = safePublicationArtifact(manuscript, opts.evidence, {
      standard: opts.standard ?? 'icmje_generic',
      ...(opts.dataset ? { dataset: opts.dataset } : {}),
      evidenceExtractions: opts.evidenceExtractions,
      claimLedger: opts.claimLedger,
      paperBlueprint: opts.paperBlueprint,
      paperQa: qa,
    });
    manuscript = {
      ...manuscript,
      ...(repairedArtifact ? { publication: repairedArtifact } : {}),
    };
  }

  opts.onStage?.(manuscript.publication?.validation.exportReady ? 'Export ready' : 'blocked');
  return manuscript;
}

export async function runPaperPipeline(opts: {
  question: string;
  bossModel: string;
  evidence: EvidenceItem[];
  specialists: SpecialistResult[];
  standard?: ManuscriptStandard;
  dataset?: UploadedDatasetSummary | null;
  onStage?: (stage: string) => void;
  evidenceGap?: string;
  mini?: boolean;
  /** If provided, the pipeline pauses after building the claim ledger and
   *  awaits the callback, allowing the user to curate claims before drafting. */
  onClaimLedger?: (ledger: ClaimLedgerEntry[]) => Promise<ClaimLedgerEntry[]>;
}): Promise<Manuscript> {
  // Generate a focused academic title before building the blueprint so the
  // manuscript title is a proper journal-style heading rather than a generic prefix.
  opts.onStage?.('Title');
  let overrideTitle: string | undefined;
  try {
    const reply = await callModel(
      opts.bossModel,
      'You write concise, formal academic manuscript titles for peer-reviewed journals. Reply with the title only — no quotation marks, no extra text, no explanation.',
      `Write a manuscript title for a ${opts.dataset ? 'original-dataset' : 'evidence-review'} biomedical manuscript addressing: ${opts.question}`,
      150,
      opts.mini ?? false,
    );
    const candidate = (reply.split('\n')[0] ?? '')
      .replace(/^[#\s"']+|[#\s"']+$/g, '')
      // Strip a leaked "Title:" label the model sometimes prepends, so the
      // manuscript title is the heading itself, not the word "Title".
      .replace(/^title\s*:\s*/i, '')
      .trim();
    if (
      candidate.length >= 10 &&
      candidate.length <= 200 &&
      !/^title$/i.test(candidate) &&
      !/\b(write|draft|generate|manuscript topic|section to write)\b/i.test(candidate)
    ) {
      overrideTitle = candidate;
    }
  } catch {
    /* keep the blueprintTitle fallback */
  }

  opts.onStage?.('Extracting');
  const evidenceExtractions = extractEvidenceFromRecords(opts.evidence);
  opts.onStage?.('Building claims');
  let claimLedger = buildClaimLedger(evidenceExtractions);
  if (opts.onClaimLedger) {
    opts.onStage?.('Awaiting claim review');
    claimLedger = await opts.onClaimLedger(claimLedger);
  }
  const paperBlueprint = buildPaperBlueprint(opts.question, claimLedger, overrideTitle, opts.mini ?? false);
  return compileManuscriptFromLedger({
    question: opts.question,
    bossModel: opts.bossModel,
    specialists: opts.specialists,
    evidence: opts.evidence,
    evidenceExtractions,
    claimLedger,
    paperBlueprint,
    ...(opts.standard ? { standard: opts.standard } : {}),
    ...(opts.dataset ? { dataset: opts.dataset } : {}),
    ...(opts.evidenceGap ? { evidenceGap: opts.evidenceGap } : {}),
    mini: opts.mini ?? false,
    ...(opts.onStage ? { onStage: opts.onStage } : {}),
  });
}
