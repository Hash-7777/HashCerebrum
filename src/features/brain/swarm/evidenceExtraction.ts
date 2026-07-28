// Turning retrieved records into structured evidence and a claim ledger.
//
// This is the deterministic half of the pipeline's reading step. Every function
// here works on what a source actually says — its title, abstract, identifiers —
// and none of them asks a model anything. A record becomes an EvidenceExtraction
// (study design, population, exposure, comparator, outcomes, sample size, effect
// estimates, limitations), and those extractions become the claim ledger the
// drafting step is allowed to write from.
//
// Two properties are worth preserving if you change anything in here.
//
// The source marker [S#] is positional and the identity hash is content-based:
// together they are what lets a later stage prove a number belongs to the record
// it is cited against. Nothing downstream can re-derive that if it is lost here.
//
// The detectors are conservative on purpose. Each one falls back to a plain
// "not reported" rather than guessing, because a fabricated population or
// comparator reads exactly like a real one once it reaches the manuscript, and
// there is no later stage that can tell the difference.

import type { EvidenceItem } from '@platform/index';
import {
  extractBoundEffects,
  extractEffectValues,
  extractSampleSize,
} from './effectExtraction';
import type {
  ClaimLedgerEntry,
  EvidenceExtraction,
  EvidenceStrength,
  ExtractedEffectValue,
  BoundEffect,
} from './publicationTypes';
import { clean, recordText } from './textNormalize';

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

function limitationsFor(record: EvidenceItem, extraction: Pick<EvidenceExtraction, 'studyDesign' | 'effectValues' | 'sampleSize'>): string[] {
  const limitations: string[] = [];
  if (!isTrustedRecord(record)) limitations.push('context-only source, not primary clinical evidence');
  if (!record.snippet || record.snippet.length < 80) limitations.push('limited abstract or snippet text available');
  if (!extraction.sampleSize) limitations.push('sample size not extracted from retrieved text');
  if (extraction.effectValues.length === 0) limitations.push('no extractable effect estimate or p-value in retrieved text');
  if (/review|meta-analysis/i.test(extraction.studyDesign)) limitations.push('secondary source; individual study data require source review');
  return limitations;
}

/** Auto-promote strong/moderate evidence claims to Clinical Evidence when that
 *  section would otherwise be empty — prevents the "no-source-backed-results"
 *  blocker from killing an otherwise viable draft. */
function autoRouteClinicalClaims(ledger: ClaimLedgerEntry[]): ClaimLedgerEntry[] {
  const hasClinical = ledger.some((e) => e.sectionTarget === 'Clinical Evidence and Safety Outcomes');
  if (hasClinical) return ledger;
  const promotable = ledger
    .filter((e) => e.evidenceStrength !== 'context' && e.sectionTarget === 'Evidence Base and Search Yield')
    .slice(0, 6);
  for (const entry of promotable) {
    entry.sectionTarget = 'Clinical Evidence and Safety Outcomes';
  }
  return ledger;
}

export function extractEvidenceFromRecords(records: EvidenceItem[]): EvidenceExtraction[] {
  return records.map((record, index) => {
    const text = recordText(record);
    const studyDesign = detectStudyDesign(record);
    const sampleSize = extractSampleSize(text);
    const effectValues = extractEffectValues(text);
    const boundEffects = extractBoundEffects(text);
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
      ...(boundEffects.length > 0 ? { boundEffects } : {}),
      limitations: limitationsFor(record, partial),
      keyFinding: firstSentence(record.snippet ?? record.title, record.title),
      trusted: isTrustedRecord(record),
    };
  });
}

/** Render bound effects for the drafting prompt — each estimate with its own CI,
 *  p-value, and inferred direction, so the model cites them as units. */
export function formatBoundEffects(effects: BoundEffect[] | undefined): string {
  if (!effects || effects.length === 0) return '';
  return effects
    .map((e) => {
      const ci = e.ci ? `, 95% CI ${e.ci}` : '';
      const p = e.pValue ? `, p=${e.pValue}` : '';
      return `${e.measure} ${e.value}${ci}${p} (${e.direction})`;
    })
    .join('; ');
}

/** A compact per-source list of the app-extracted effect estimates, fed to the
 *  abstract so its Results field cannot contradict the body (a real run's
 *  abstract claimed an agent "lacks efficacy data" while the body cited that same
 *  source's hazard ratios, because the flat body digest had truncated the section
 *  that reported them). Bounded so it never overflows the abstract prompt. */
export function abstractStatsDigest(extractions: EvidenceExtraction[]): string {
  const lines = extractions
    .filter((item) => (item.boundEffects?.length ?? 0) > 0)
    .map((item) => `${item.sourceMarker} ${formatBoundEffects(item.boundEffects)}`);
  return lines.length > 0 ? lines.join('\n').slice(0, 1500) : '(no effect estimates were extracted)';
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

/** Fix erratic internal capitalization from OCR / model output:
 *  e.g. "acUte heart faiLure … StabilizEd" → "Acute heart failure … Stabilized" */
export function fixOcrCasing(text: string): string {
  return text
    .replace(/\b[a-z]*[a-z][A-Z][a-z]*\b/g, (word) => word.toLowerCase())
    .replace(/^([a-z])/, (_, c) => c.toUpperCase());
}

function claimForExtraction(extraction: EvidenceExtraction): string {
  return fixOcrCasing(clean(extraction.keyFinding || extraction.title));
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
      // Guard I11: do not merge user-supplied trial data ([P#]) with retrieved
      // abstracts ([S#]) — prevents the model from importing population details
      // or eligibility criteria from a retrieved source into a named trial.
      const isSynthetic = (marker: string) => marker.startsWith('[P');
      const hasSynthetic = existing.supportingSources.some(isSynthetic);
      const isNewSynthetic = isSynthetic(extraction.sourceMarker);
      if (hasSynthetic !== isNewSynthetic) {
        // Fall through to create a new claim entry instead of merging.
      } else {
        existing.supportingSources = [...new Set([...existing.supportingSources, extraction.sourceMarker])];
        existing.numericSupport = [...new Set([...existing.numericSupport, ...numericSupport])];
        existing.contradictionNotes = [...new Set([...existing.contradictionNotes, ...extraction.limitations])];
        if (existing.evidenceStrength === 'context' && strengthFor(extraction) !== 'context') {
          existing.evidenceStrength = strengthFor(extraction);
        }
        continue;
      }
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
  let ledger = [...byClaim.values()];
  // Auto-route claims to Clinical Evidence if empty, then re-apply
  ledger = autoRouteClinicalClaims(ledger);
  return ledger;
}

// When the user explicitly names the paper — titled "...", entitled "...", or
// title: "..." — use that title verbatim instead of letting the model draft
// (and sometimes truncate) one. Honest and predictable: the document is titled
// exactly what the user asked for. Handles straight and curly quotes.

