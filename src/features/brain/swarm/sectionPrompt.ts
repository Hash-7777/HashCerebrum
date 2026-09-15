// The prompt one manuscript section is drafted from: the section system prompt,
// the claim ledger and extraction excerpts assigned to that section, and the
// digests that give it context.
//
// Every variable block is capped to a character budget, so the whole request
// fits a small (~8k-token) context window and a free-tier tokens-per-minute
// quota on the first attempt — the shrink-and-retry loop is what used to turn a
// free-tier run into a blocked draft. Pure, so its size is tested without a
// model call.

import type { ClaimLedgerEntry, EvidenceExtraction, PaperBlueprint } from './publicationTypes';
import type { SpecialistResult } from './types';
import { assessRiskOfBias, formatRobSummary } from './riskOfBias';
import { formatBoundEffects } from './evidenceExtraction';
import { clean } from './textNormalize';

export const SECTION_SYSTEM = `You are the HashCerebrum agent, a biomedical manuscript compiler. Write EXACTLY ONE SECTION per call.

DEPTH — density, not length:
- Cover every claim assigned to this section once, in depth: state the finding, explain mechanism/significance, place it in clinical context, note limitations, connect it to the broader question.
- NEVER repeat a sentence, claim, or paragraph, and never restate the same point in different words to reach a length. When the assigned evidence is fully covered, STOP — a shorter, non-repetitive section is REQUIRED over a padded one. Repetition is the worst possible failure here.
- If evidence is thin, write a transparent evidence-gap analysis rather than padding.

INTEGRITY — this is a REVIEW of retrieved literature, NOT original research:
- NEVER claim original data collection ("we conducted", "enrolled patients", "EHR analysis", "propensity-score matching", etc.).
- Methods = automated search workflow ONLY. Describe the searches that actually ran (the sub-query concepts and the sources queried), not the user's question typed verbatim.
- Report findings as what sources report ("study [S3] reported…"). Attribute every number.
- NEVER claim a formal appraisal you did not run: do NOT write that records were "rated with GRADE certainty", assessed with "ROBINS-I" / "AMSTAR" / "Cochrane RoB", or "flagged for some concerns". You may only state that NO formal risk-of-bias or GRADE appraisal was applied.
- A statistic belongs to ONE study: report an effect estimate together with the SAME study's confidence interval and p-value. NEVER pair an estimate from one record with a CI or p-value from another, and never call a confidence interval that crosses 1.0 "significant".
- Do NOT state a specific total number of records or participants in prose (e.g. "60 records", "140 participants"); refer to the source-yield figure instead — invented counts contradict the deterministic figures.
- Use ONE consistent population definition matching the question; do not drift between ≥60, ≥70, and ≥75.
- Calibrate confidence to the evidence: for an abstract-only, low-certainty corpus, never assert a "confident" or "definitive" conclusion — hedge to what the retrieved evidence actually supports.

FORMAT — deviations corrupt the pipeline:
- Begin with the first word of the section body. No preamble, heading, number, or title.
- Write ONLY this section. No other sections.
- FORBIDDEN: numbered outlines, markdown headings, bullet lists, tables.
- Use continuous academic prose paragraphs separated by blank lines.
- Cite approved [S#] markers for every factual claim.
- Do not invent PMIDs, DOIs, p-values, CIs, ORs, HRs, or pooled estimates.
- Use numeric statistics ONLY from the extracted numeric support block or uploaded dataset.`;

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
  const rob = formatRobSummary(assessRiskOfBias(extraction));
  const bound = formatBoundEffects(extraction.boundEffects);
  return [
    `${extraction.sourceMarker} ${extraction.source.toUpperCase()} ${extraction.year ?? 'year not reported'} ${extraction.title}`,
    `Identifiers: ${ids || 'not available'}`,
    `Design: ${extraction.studyDesign}`,
    `RoB: ${rob}`,
    `Population: ${extraction.population}`,
    `Exposure: ${extraction.exposureOrIntervention}`,
    `Comparator: ${extraction.comparator}`,
    `Outcomes: ${extraction.outcomes.join(', ') || 'not reported'}`,
    ...(bound ? [`Bound effects (cite each as a unit; do NOT mix CIs/p-values across studies): ${bound}`] : []),
    `Numeric: ${numeric || 'none extracted'}`,
    `Key finding: ${extraction.keyFinding}`,
    `Limits: ${extraction.limitations.join('; ') || 'none recorded'}`,
  ].join(' | ');
}

function sourceYieldBlock(extractions: EvidenceExtraction[]): string {
  const counts = new Map<string, number>();
  for (const item of extractions) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => `${source}: ${count}`).join(', ');
}

export function specialistRoleDigest(specialists: SpecialistResult[]): string {
  const usable = specialists.filter((specialist) => specialist.evidence.length > 0 || specialist.findings.trim());
  if (usable.length === 0) return 'No specialist role summaries were available beyond retrieved source records.';
  return usable
    .map(
      (specialist) =>
        `${specialist.label}: ${specialist.evidence.length} retrieved record(s). ${clean(specialist.findings).slice(0, 420)}`,
    )
    .join('\n');
}

// Budgets (in characters) for the variable-size blocks of a section prompt. The
// full drafting prompt was ~15k chars, which overflowed small (≈8k-token) models
// — forcing the wasteful "retrying smaller" shrink loop — and, more importantly,
// blew a free-tier tokens-per-minute quota so the run stalled and shipped
// "blocked". Capping the blocks keeps the whole request small enough to fit on
// the FIRST attempt and to stay under a per-minute budget. The claim ledger
// (already capped at 12 claims) is kept in full because it is the instruction;
// the extraction detail, digests, and repair body are the parts that grow.
const SECTION_EXTRACTION_BUDGET = 5000;

const SECTION_PRIOR_DIGEST_BUDGET = 1200;

const SECTION_SPECIALIST_DIGEST_BUDGET = 900;

const SECTION_CURRENT_BODY_BUDGET = 1600;

function trimTo(text: string, budget: number): string {
  return text.length <= budget ? text : `${text.slice(0, budget).trimEnd()}…`;
}

// Keep the most relevant extractions up to a character budget, ALWAYS keeping at
// least the first, and note how many more remain in the evidence table so the
// model knows the corpus is larger than the excerpt it was handed.
function cappedExtractionBlock(relevant: EvidenceExtraction[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const extraction of relevant) {
    const line = formatExtraction(extraction);
    if (lines.length > 0 && used + line.length > SECTION_EXTRACTION_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
  }
  const dropped = relevant.length - lines.length;
  if (dropped > 0) {
    lines.push(
      `(+${dropped} further retrieved record(s) for this section are summarised in the evidence table and the source-yield counts above; cite only the [S#] listed here.)`,
    );
  }
  return lines.join('\n');
}

// Assemble the section drafting prompt with every variable block capped to its
// budget, so the request fits a small context window and a free-tier per-minute
// token quota on the first attempt. Pure and deterministic — unit-tested for
// size without a model call.
export function buildSectionUserPrompt(opts: {
  question: string;
  section: PaperBlueprint['sections'][number];
  claims: ClaimLedgerEntry[];
  extractions: EvidenceExtraction[];
  specialistDigest: string;
  datasetBlock: string;
  priorDigest: string;
  currentBody?: string[];
  evidenceGap?: string;
  methodsNotes?: string;
}): string {
  const sourceMarkers = new Set(opts.claims.flatMap((claim) => claim.supportingSources));
  const relevantExtractions = opts.extractions.filter((item) => sourceMarkers.has(item.sourceMarker));
  const claimsBlock = opts.claims.map(formatClaim).join('\n');
  const extractionBlock = cappedExtractionBlock(relevantExtractions);
  const current = opts.currentBody?.length
    ? `\nCurrent draft to repair:\n${trimTo(opts.currentBody.join('\n\n'), SECTION_CURRENT_BODY_BUDGET)}\n`
    : '';
  const gapNote = opts.evidenceGap ? `\nEVIDENCE GAP — MANDATORY HONESTY:\n${opts.evidenceGap}\n` : '';
  const methodsNote =
    opts.methodsNotes && opts.section.heading.toLowerCase() === 'methods'
      ? `\nDETERMINISTIC PIPELINE FACTS — expand these; do not invent alternatives:\n${opts.methodsNotes}\n`
      : '';
  const hasSynthetic = opts.extractions.some((e) => e.sourceMarker.startsWith('[P'));
  const syntheticIsolation = hasSynthetic
    ? `
AUTHOR-SUPPLIED TRIALS ([P#]):
These trials were supplied by the user, not retrieved from a database. Describe them using ONLY their provided statistics and title. Do NOT import population details, eligibility criteria, or subgroup descriptions from retrieved [S#] sources into an [P#] trial description.`
    : '';
  return `Topic: ${opts.question}
${gapNote}
Section: ${opts.section.heading}
Intent: ${opts.section.intent}
Target: ${opts.section.targetWords} | Min: ${opts.section.minWords}
Markers: ${[...sourceMarkers].join(', ') || '(none)'}
${methodsNote}
CLAIM LEDGER:
${claimsBlock || 'No direct claims. Write a transparent evidence-gap section.'}

EXTRACTIONS:
${extractionBlock || 'No direct extractions.'}
${syntheticIsolation}

Source yield: ${sourceYieldBlock(opts.extractions)}

Agents: ${trimTo(opts.specialistDigest, SECTION_SPECIALIST_DIGEST_BUDGET)}

Dataset: ${opts.datasetBlock}

Prior sections: ${trimTo(opts.priorDigest, SECTION_PRIOR_DIGEST_BUDGET)}
${current}
Write ${opts.section.heading} now. Start with the first sentence — no heading, no number. Cover each claim once, in depth; do NOT repeat, restate, or pad to reach a length. Every sentence must trace to a claim or extraction.
STATISTICS LOCK: attach a hazard/odds/risk ratio, confidence interval, or p-value ONLY to the exact [S#] whose EXTRACTIONS above list that number. Never give a source a statistic it does not report, never cite the same source's estimate two different ways, and never invent a number to sound precise. If no effect sizes exist, state that limitation clearly, then compensate with rich contextual discussion.`;
}
