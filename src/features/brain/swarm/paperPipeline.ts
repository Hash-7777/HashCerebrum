import { isRateLimited as isCallRateLimited } from '@core/llm/errorKind';
import { bus } from '@core/bus/EventBus';
import type { EvidenceItem } from '@platform/index';
import {
  parseAbstract,
  sectionBodyFromReply,
  type Manuscript,
  type ManuscriptSection,
} from './manuscript';
import { buildPublicationArtifact } from './publication';
import type {
  ClaimLedgerEntry,
  EvidenceExtraction,
  ManuscriptStandard,
  PaperBlueprint,
  UploadedDatasetSummary,
} from './publicationTypes';
import { datasetSummaryForPrompt } from './statistics';
import type { SpecialistResult } from './types';
import { parsePromptEffectRows, resetSyntheticIds, toSyntheticExtractions } from './promptEffectData';
import { applyHonestyPass, splitSentences } from './honestyGuard';
import { isDamagedSentence } from './sentenceDamage';
import { neutralizeUnsupportedComparator } from './comparatorGuard';
import { dedupeParagraphs, dedupeAcrossSections } from './dedupe';
import {
  abstractStatsDigest,
  buildClaimLedger,
  extractEvidenceFromRecords,
} from './evidenceExtraction';
import {
  buildQuantEvidenceTable,
  neutralizeMisattributedGeneStatistics,
  neutralizeUnverifiedStatistics,
} from './statisticVerification';
import { buildMethodsSection, deterministicMethodsNotes } from './methodsSection';
import { extractExplicitTitle, keywordsFrom, titleTopic } from './paperTitle';
import {
  validateDraftIdentifiers,
  neutralizeUnverifiableNct,
  claimSourceFidelity,
} from './draftIntegrity';
import { callModel } from './paperModelCall';
import { SECTION_SYSTEM, specialistRoleDigest, buildSectionUserPrompt } from './sectionPrompt';
import { buildPaperBlueprint, claimsForBlueprintSection } from './paperBlueprint';
import { MAX_QA_REPAIR_PASSES, validatePaperPackage, repairableSectionNames } from './paperQa';


const SECTION_TOKENS = 5800;
// Brain Mini drafts shorter sections so a small / free model finishes quickly.
const MINI_SECTION_TOKENS = 1600;
const MAX_SECTION_PASSES = 2;
// Visible marker prefixed to any section the pipeline could not properly draft
// or repair, so an incomplete section is never silently shipped as if finished.
const SECTION_REVIEW_FLAG = '⚠ SECTION NEEDS REVIEW —';

// Prepended to a manuscript finalized with unresolved blockers (e.g. sections
// left incomplete when a free-tier provider rate-limited mid-draft), so the
// warning ships inside the document rather than only in the execution trace.
export const INCOMPLETE_DRAFT_BANNER = '⚠ INCOMPLETE DRAFT';

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

function wordCount(value: string): number {
  return value.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length;
}

function bodyWordCount(body: string[]): number {
  return wordCount(body.join(' '));
}

// Remove inline [S#] markers a drafted section cites that are NOT in the approved
// claim ledger. The drafting model occasionally emits markers beyond the ledger it
// was handed (e.g. [S79] when the ledger tops out far lower). Left in, they trip
// the export gate's `citation-not-in-claim-ledger` blocker — and on free-tier the
// QA-repair pass that would otherwise fix them can itself be rate-limited, so the
// whole paper ends "blocked" with no output. Stripping the unapproved markers
// deterministically keeps every legitimate ledger citation, lets the gate pass
// without a model call, and guarantees the body and reference list agree.
//
// A marker used as a citation ("…a benefit [S9].") comes out cleanly. A marker
// used as a noun ("The most recent record is [S9], which…", "[S9] supplies…")
// cannot: removing it leaves a hole. Such a sentence is dropped whole — its
// subject was a record the ledger does not approve, so it has no claim to keep.
export function stripUnapprovedMarkers(
  sections: ManuscriptSection[],
  approvedMarkers: Set<string>,
): ManuscriptSection[] {
  const approvedNums = new Set(
    [...approvedMarkers].map((m) => m.match(/\d+/)?.[0]).filter((n): n is string => Boolean(n)),
  );
  const tidy = (text: string): string =>
    text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,;:)])/g, '$1')
      .trim();
  const cleanSentence = (sentence: string): string => {
    const opensWithUnapproved = /^\s*\[S(\d+)\]/.exec(sentence);
    if (opensWithUnapproved && !approvedNums.has(opensWithUnapproved[1]!)) return '';
    const out = sentence.replace(/ ?\[S(\d+)\]/g, (full: string, n: string) => (approvedNums.has(n) ? full : ''));
    if (out === sentence) return sentence;
    const tidied = tidy(out);
    return isDamagedSentence(tidied) ? '' : tidied;
  };
  const clean = (paragraph: string): string => {
    const cited = [...paragraph.matchAll(/\[S(\d+)\]/g)].map((m) => m[1]!);
    if (cited.every((n) => approvedNums.has(n))) return paragraph; // nothing to remove
    // A marker written after the full stop ("…a benefit. [S9] Next…") belongs
    // to the sentence before it; move it inside so the split keeps it there.
    const placed = paragraph.replace(
      /([.!?])((?:\s*\[S\d+\])+)(?=\s+[A-Z]|\s*$)/g,
      (_m, stop: string, markers: string) => ` ${markers.trim()}${stop}`,
    );
    return tidy(splitSentences(placed).map(cleanSentence).filter((s) => s.trim()).join(' '));
  };
  return sections.map((section) => ({ ...section, body: section.body.map(clean).filter((p) => p.trim()) }));
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
  methodsNotes?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  if (opts.signal?.aborted) throw new Error('Run stopped by user');
  const sourceMarkers = new Set(opts.claims.flatMap((claim) => claim.supportingSources));
  const userPrompt = buildSectionUserPrompt({
    question: opts.question,
    section: opts.section,
    claims: opts.claims,
    extractions: opts.extractions,
    specialistDigest: opts.specialistDigest,
    datasetBlock: opts.datasetBlock,
    priorDigest: opts.priorDigest,
    ...(opts.currentBody ? { currentBody: opts.currentBody } : {}),
    ...(opts.evidenceGap ? { evidenceGap: opts.evidenceGap } : {}),
    ...(opts.methodsNotes ? { methodsNotes: opts.methodsNotes } : {}),
  });
  const reply = await callModel(
    opts.model,
    SECTION_SYSTEM,
    userPrompt,
    opts.mini ? MINI_SECTION_TOKENS : SECTION_TOKENS,
    opts.mini ?? false,
    opts.signal,
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

// Distributed drafting: a body section is drafted on the model of the specialist
// that gathered its evidence, so the load spreads across the swarm's providers
// instead of hammering one boss model section after section (the main source of
// free-tier rate-limit churn). Connective sections (Intro / Methods / Discussion /
// Limitations / Conclusion) and any section whose owner is unknown stay on the
// boss model, which holds the whole-paper context.
export function modelForSection(heading: string, specialists: SpecialistResult[], bossModel: string): string {
  const h = heading.toLowerCase();
  const pick = (agentId: string): string | undefined =>
    specialists.find((s) => s.agentId === agentId && s.model && !s.error)?.model;
  let m: string | undefined;
  if (/mechanis|pharmacolog|pharmacokinetic|drug/.test(h)) m = pick('pharmacist');
  else if (/clinical|trial|registry|outcome|safety/.test(h)) m = pick('clinical_research');
  else if (/evidence base|search yield|\bresults\b|synthesis/.test(h)) m = pick('evidence_synthesis');
  return m ?? bossModel;
}

interface CompileSectionsOpts {
  question: string;
  bossModel: string;
  specialists: SpecialistResult[];
  evidence: EvidenceItem[];
  extractions: EvidenceExtraction[];
  claimLedger: ClaimLedgerEntry[];
  paperBlueprint: PaperBlueprint;
  dataset?: UploadedDatasetSummary | null;
  onStage?: (stage: string) => void;
  repairTargets?: Map<string, string[]>;
  existingSections?: ManuscriptSection[];
  evidenceGap?: string;
  mini?: boolean;
  // Shared, run-scoped budget signal. Set to rateLimited once any section call
  // exhausts its rate-limit retries, so the rest of the run stops spending
  // optional expansion calls and ships clean shorter drafts instead of stalling.
  budget?: { rateLimited: boolean };
  signal?: AbortSignal;
}

// Only spend an extra model call to grow a section when it is MATERIALLY short.
// A section already at ~85% of its minimum reads fine, and topping it up from 640
// to 700 words is not worth a call on a limited quota. And once the run has been
// rate-limited to exhaustion, skip expansions entirely — ship the clean shorter
// draft rather than burn quota (and risk stalling) to pad it. This is the padding
// that also produced repeated paragraphs on weak models.
export function shouldExpandSection(words: number, minWords: number, rateLimited: boolean): boolean {
  if (rateLimited) return false;
  return words < minWords * 0.85;
}

// Connective sections narrate ACROSS the evidence, so they are written in wave 2
// once the body sections exist. Everything else is a self-contained body section
// (evidence base, mechanism, clinical, trials, methods) that can be written in
// parallel in wave 1.
const CONNECTIVE_SECTION = /introduction|discussion|conclusion|limitation/i;
const DRAFT_CONCURRENCY = 3;

// Run an async task over items with a bounded concurrency, preserving no order
// (callers write into a shared map keyed by heading).
async function mapPool<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await task(items[index]!);
    }
  });
  await Promise.all(workers);
}

// Draft ONE section from the claim ledger, with all the per-section guards:
// evidence-gap injection, deterministic methods notes, distributed model choice,
// identifier validation + NCT neutralisation, the claim↔source fidelity gate, and
// bounded expansion to the minimum word count. Pure per-section work, so it is
// safe to run several of these concurrently.
async function draftOneSection(
  opts: CompileSectionsOpts,
  blueprintSection: PaperBlueprint['sections'][number],
  priorDigest: string,
  roleDigest: string,
  datasetBlock: string,
): Promise<ManuscriptSection> {
  opts.onStage?.(opts.repairTargets?.has(blueprintSection.heading) ? `QA repair ${blueprintSection.heading}` : blueprintSection.heading);
  const claims = claimsForBlueprintSection(blueprintSection, opts.claimLedger);
  const assignedMarkers = [...new Set(claims.flatMap((claim) => claim.supportingSources))];
  const existing = opts.existingSections?.find((section) => section.heading === blueprintSection.heading);
  // Evidence gap is injected into ONE section only so it does not leak into every
  // section and repeat the same honesty note 9× (I3).
  const isLimitations = blueprintSection.heading.toLowerCase().includes('limitation');
  const isMethods = blueprintSection.heading.toLowerCase().includes('method');
  const shouldInjectGap =
    opts.evidenceGap &&
    (isLimitations ||
      (!opts.paperBlueprint.sections.some((s) => s.heading.toLowerCase().includes('limitation')) && isMethods));
  // Evidence-review Methods is generated deterministically in code (see
  // buildMethodsSection) — no model call, no drift, identical every run. An
  // original-research paper with an uploaded dataset still drafts Methods with
  // the model, because that section must describe the dataset and its analysis.
  if (isMethods && !opts.dataset) {
    return {
      heading: blueprintSection.heading,
      body: buildMethodsSection(
        opts.question,
        opts.evidence,
        opts.extractions,
        shouldInjectGap ? opts.evidenceGap : undefined,
      ),
    };
  }
  const methodsNotes = isMethods
    ? deterministicMethodsNotes(opts.question, opts.evidence, opts.extractions)
    : undefined;
  const sectionModel = modelForSection(blueprintSection.heading, opts.specialists, opts.bossModel);
  let body: string[];
  try {
    body = await draftLedgerSection({
      model: sectionModel,
      question: opts.question,
      section: blueprintSection,
      claims,
      extractions: opts.extractions,
      specialistDigest: roleDigest,
      datasetBlock,
      priorDigest,
      ...(existing ? { currentBody: existing.body } : {}),
      ...(shouldInjectGap ? { evidenceGap: opts.evidenceGap } : {}),
      mini: opts.mini ?? false,
      ...(methodsNotes ? { methodsNotes } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // A section call that exhausts its rate-limit retries is the signal that the
    // providers are hammered — go lean for the rest of the run.
    if (isCallRateLimited(error) && opts.budget) opts.budget.rateLimited = true;
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

  // C3: validate identifiers in the drafted prose against retrieved evidence.
  const idIssues = validateDraftIdentifiers(body.join(' '), opts.evidence);
  if (idIssues.length > 0) {
    bus.emit('agent:activity', {
      agentId: 'boss',
      phase: 'tool_call',
      detail: `${blueprintSection.heading}: unverifiable identifiers flagged — ${idIssues.join(', ')}`,
    });
    const badNcts = idIssues.filter((id) => /^NCT\d{8,}$/i.test(id));
    if (badNcts.length > 0) body = body.map((paragraph) => neutralizeUnverifiableNct(paragraph, badNcts));
  }

  // C6: claim↔source fidelity gate — flag claims whose wording drifts from evidence.
  for (const claim of claims) {
    const sourceTexts = opts.extractions
      .filter((e) => claim.supportingSources.includes(e.sourceMarker))
      .map((e) => `${e.title} ${e.keyFinding}`);
    if (claimSourceFidelity(claim.claim, sourceTexts).flag) {
      bus.emit('agent:activity', {
        agentId: 'boss',
        phase: 'tool_call',
        detail: `${blueprintSection.heading} claim fidelity low for "${claim.claim.slice(0, 80)}…"`,
      });
    }
  }

  // Bounded expansion to the minimum word count (skip if the draft already failed).
  const draftFailed = body.length > 0 && body[0]!.startsWith(SECTION_REVIEW_FLAG);
  // Collapse near-duplicate paragraphs a weak model emits while padding, so the
  // word count reflects real content and repetition never ships (D1 — a real run
  // shipped the same Introduction paragraphs five times).
  if (!draftFailed) body = dedupeParagraphs(body);
  let passes = 1;
  while (
    !draftFailed &&
    shouldExpandSection(bodyWordCount(body), blueprintSection.minWords, opts.budget?.rateLimited ?? false) &&
    passes < MAX_SECTION_PASSES
  ) {
    opts.onStage?.(`${blueprintSection.heading} expansion ${passes}`);
    const beforeWords = bodyWordCount(body);
    try {
      body = await draftLedgerSection({
        model: sectionModel,
        question: opts.question,
        section: blueprintSection,
        claims,
        extractions: opts.extractions,
        specialistDigest: roleDigest,
        datasetBlock,
        priorDigest,
        currentBody: body,
        ...(shouldInjectGap ? { evidenceGap: opts.evidenceGap } : {}),
        mini: opts.mini ?? false,
        ...(methodsNotes ? { methodsNotes } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (error) {
      // Expansion is optional — if it rate-limits, stop growing this section and
      // go lean for the rest of the run rather than retrying into the quota.
      if (isCallRateLimited(error) && opts.budget) opts.budget.rateLimited = true;
      break;
    }
    body = dedupeParagraphs(body);
    // If a pass added no genuinely new content (only repeats the dedupe removed),
    // stop rather than looping on padding.
    if (bodyWordCount(body) <= beforeWords) break;
    passes += 1;
  }
  // Run the deterministic honesty pass on the drafted prose HERE, at the source,
  // so the manuscript stored and shown in the chat matches the exported PDF —
  // otherwise fabricated aggregates / invented record counts (e.g. "strong = 33",
  // "209 records") were only stripped at export and leaked into the live preview.
  // A section that is nothing but the review flag is left untouched.
  if (!(body.length > 0 && body[0]!.startsWith(SECTION_REVIEW_FLAG))) {
    body = body.map((paragraph) => applyHonestyPass(paragraph));
  }

  // WS-1b: remove any statistic attributed to a source that does not report it
  // (a misattributed or invented estimate — e.g. one study cited with two
  // different hazard ratios), keeping the surrounding claim in words. Fail-safe:
  // sentence-scoped, and only acts when the cited source reports some other
  // extracted statistic (so a genuine misattribution is removed, not an
  // extraction gap). A section whose draft failed is left as its review flag.
  if (!(body.length > 0 && body[0]!.startsWith(SECTION_REVIEW_FLAG))) {
    const qet = buildQuantEvidenceTable(opts.extractions);
    const removed: string[] = [];
    body = body.map((paragraph) => {
      const marker = neutralizeUnverifiedStatistics(paragraph, qet);
      // Then strip an effect magnitude pinned to a gene none of that gene's own
      // sources report — the case the marker table cannot judge (empty cited
      // source), so a number lifted from an unrelated study can't stay next to
      // the wrong gene.
      const gene = neutralizeMisattributedGeneStatistics(marker.text, opts.question, opts.evidence);
      // Then strip a fabricated head-to-head comparator: an effect estimate the
      // draft frames as "arm A relative to arm B" when no retrieved source
      // compared the two arms (they were each compared to placebo / other drugs).
      const comparator = neutralizeUnsupportedComparator(gene.text, opts.question, opts.evidence);
      removed.push(...marker.removed, ...gene.removed, ...comparator.removed);
      return comparator.text;
    });
    if (removed.length > 0) {
      bus.emit('agent:activity', {
        agentId: 'boss',
        phase: 'tool_call',
        detail: `${blueprintSection.heading}: removed ${removed.length} statistic(s) not backed by the cited source — ${removed
          .slice(0, 3)
          .map((s) => `"${s}"`)
          .join('; ')}`,
      });
    }
  }

  return { heading: blueprintSection.heading, body };
}

// Two-wave distributed drafting. Wave 1 writes the self-contained body sections in
// PARALLEL (each on its owning specialist's model); wave 2 then writes the
// connective narrative (Introduction / Discussion / Conclusion / Limitations) on
// the boss model from a digest of the finished body sections, so coherence holds
// without the whole paper being written one slow section at a time.
async function compileSections(opts: CompileSectionsOpts): Promise<ManuscriptSection[]> {
  const roleDigest = specialistRoleDigest(opts.specialists);
  const datasetBlock = opts.dataset ? datasetSummaryForPrompt(opts.dataset) : '(no uploaded dataset was supplied)';
  const done = new Map<string, ManuscriptSection>();
  const toDraft: PaperBlueprint['sections'][number][] = [];

  // First pass (no model calls): resolve reused / Declarations / no-claim gap
  // sections, and collect the ones that need drafting.
  for (const blueprintSection of opts.paperBlueprint.sections) {
    if (opts.signal?.aborted) throw new Error('Run stopped by user');
    if (opts.repairTargets && !opts.repairTargets.has(blueprintSection.heading)) {
      const existing = opts.existingSections?.find((section) => section.heading === blueprintSection.heading);
      if (existing) {
        done.set(blueprintSection.heading, existing);
        continue;
      }
    }
    if (blueprintSection.heading === 'Declarations') {
      done.set(blueprintSection.heading, declarationSection());
      continue;
    }
    if (claimsForBlueprintSection(blueprintSection, opts.claimLedger).length === 0) {
      done.set(blueprintSection.heading, deterministicGapSection(blueprintSection, opts.extractions.map((item) => item.sourceMarker)));
      continue;
    }
    toDraft.push(blueprintSection);
  }

  // Wave 1 — body sections, in parallel (no cross-section dependency).
  const bodySections = toDraft.filter((s) => !CONNECTIVE_SECTION.test(s.heading));
  await mapPool(bodySections, DRAFT_CONCURRENCY, async (blueprintSection) => {
    const section = await draftOneSection(opts, blueprintSection, '(body sections are written in parallel)', roleDigest, datasetBlock);
    done.set(blueprintSection.heading, section);
  });

  // Wave 2 — connective narrative, from a digest of every section written so far
  // (body + reused + gap), in blueprint order, so it ties them together.
  const bodyDigest =
    opts.paperBlueprint.sections
      .map((s) => done.get(s.heading))
      .filter((sec): sec is ManuscriptSection => !!sec)
      .map((sec) => `${sec.heading}: ${(sec.body[0] ?? '').slice(0, 220)}`)
      .join('\n') || '(none yet)';
  const connectiveSections = toDraft.filter((s) => CONNECTIVE_SECTION.test(s.heading));
  await mapPool(connectiveSections, DRAFT_CONCURRENCY, async (blueprintSection) => {
    const section = await draftOneSection(opts, blueprintSection, bodyDigest, roleDigest, datasetBlock);
    done.set(blueprintSection.heading, section);
  });

  // Reassemble in blueprint order.
  return opts.paperBlueprint.sections
    .map((s) => done.get(s.heading))
    .filter((sec): sec is ManuscriptSection => !!sec);
}

async function draftAbstract(opts: {
  model: string;
  title: string;
  question: string;
  evidence: EvidenceItem[];
  sections: ManuscriptSection[];
  claimLedger: ClaimLedgerEntry[];
  extractions: EvidenceExtraction[];
  signal?: AbortSignal;
}): Promise<Manuscript['abstract']> {
  if (opts.signal?.aborted) throw new Error('Run stopped by user');
  const strong = opts.claimLedger.filter((claim) => claim.evidenceStrength === 'strong').length;
  const moderate = opts.claimLedger.filter((claim) => claim.evidenceStrength === 'moderate').length;
  const weak = opts.claimLedger.filter((claim) => claim.evidenceStrength === 'weak').length;
  const context = opts.claimLedger.filter((claim) => claim.evidenceStrength === 'context').length;
  const numeric = opts.extractions.reduce((sum, item) => sum + item.effectValues.length + (item.sampleSize ? 1 : 0), 0);
  // Balance the digest across sections. A flat 7000-char head slice dropped the
  // later Clinical/Results section entirely, so the abstract claimed an agent had
  // "no efficacy data" while the body reported its hazard ratios — give every
  // section an equal share so each is represented.
  const perSection = Math.max(500, Math.floor(7000 / Math.max(1, opts.sections.length)));
  const digest = opts.sections
    .map((section) => `${section.heading}\n${section.body.join(' ').slice(0, perSection)}`)
    .join('\n\n');
  // Feed the abstract the app-extracted effect estimates directly so the Results
  // field can never contradict the body's numbers.
  const statsDigest = abstractStatsDigest(opts.extractions);
  // Deterministic fallback abstract — always non-empty, so the manuscript never
  // ships with a blank ABSTRACT (which happened when the model replied without
  // the labelled fields and the parse came back empty).
  // Count-free wording: the exact record / strength counts live in the evidence
  // figures, not the prose — stating them here reads as a fabricated study
  // statistic and is stripped by the honesty pass anyway.
  const fallback: Manuscript['abstract'] = {
    background: 'This evidence-review draft was generated from guarded biomedical source retrieval and structured extraction.',
    objective: fallbackObjective(opts.title),
    methods: 'The pipeline retrieved records from guarded biomedical sources, extracted structured evidence, built a source-backed claim ledger, and blocked unsupported statistics.',
    results: 'The claim ledger organised the retrieved evidence by strength and captured the source-reported effect estimates; the accompanying evidence figures give the counts.',
    conclusions: 'The draft should be reviewed against full source records before submission or clinical use.',
  };
  try {
    const reply = await callModel(
      opts.model,
      'You write structured scientific abstracts for source-grounded biomedical AUTOMATED EVIDENCE REVIEWS. Reply with exactly five labelled fields: Background:, Objective:, Methods:, Results:, Conclusions:. Do not add references or unsupported statistics. CRITICAL: this is a review of retrieved published literature, not an original study. The Methods field must describe ONLY the automated literature search and synthesis — never claim a cohort was studied, patients were enrolled, electronic health records or propensity-score matching were used, or that you measured any outcome. The Results field reports what the retrieved sources found, never results you produced. If effect estimates are supplied below, the Results field MUST reflect them and MUST NOT state that any intervention lacks efficacy or safety data when an estimate for it is listed — that contradicts the body.',
      `Write a structured abstract for "${opts.title}" using only this manuscript body and these app-owned statistics. This is an automated evidence review; do not invent a study design or primary data.

Evidence-strength counts: strong ${strong}, moderate ${moderate}, weak ${weak}, context ${context}.
Extracted numeric statistic/sample-size fields: ${numeric}.

App-extracted effect estimates by source (the Results field must be consistent with these):
${statsDigest}

Manuscript body:
${digest}`,
      1200,
      false,
      opts.signal,
    );
    const parsed = parseAbstract(reply);
    // A model can reply without the labelled fields, leaving the parse empty —
    // never ship that. Backfill any thin field from the deterministic fallback.
    if (!isSubstantiveAbstract(parsed)) return fallback;
    // The Results/Conclusions fields are the model's free prose over source-bound
    // numbers, so it can pin a real figure to the wrong subject — the sections get
    // this same attribution scrub, but the abstract did not, which is how a
    // factor-V "relative risk of 15.2" reached the abstract labelled as MTHFR.
    // Verify each effect magnitude against BOTH the cited source (marker table)
    // and every source that mentions the named gene, dropping any the evidence
    // does not support before the honesty pass and export.
    const qet = buildQuantEvidenceTable(opts.extractions);
    const scrub = (field: string): string =>
      applyHonestyPass(
        neutralizeUnsupportedComparator(
          neutralizeMisattributedGeneStatistics(
            neutralizeUnverifiedStatistics(field.trim(), qet).text,
            opts.question,
            opts.evidence,
          ).text,
          opts.question,
          opts.evidence,
        ).text,
      );
    // Honesty-pass each field at the source so the preview matches the export —
    // the abstract prompt is fed the evidence-strength counts, so the model tends
    // to write "strong = 33, moderate = 29 …" into Results, which reads as a
    // fabricated study statistic and is stripped here rather than only at export.
    return {
      background: applyHonestyPass(parsed.background.trim()) || fallback.background,
      objective: applyHonestyPass(parsed.objective.trim()) || fallback.objective,
      methods: applyHonestyPass(parsed.methods.trim()) || fallback.methods,
      results: scrub(parsed.results) || fallback.results,
      conclusions: scrub(parsed.conclusions) || fallback.conclusions,
    };
  } catch {
    return fallback;
  }
}

/** The fallback abstract's objective. A title made by the fallback title path
 *  starts "Evidence Review:" (or "Evidence Review of"); that prefix is the
 *  document type, not the topic, so it is not repeated inside the sentence. */
export function fallbackObjective(title: string): string {
  const topic = title.replace(/^Evidence Review(?:\s+of|\s*:)\s*/i, '').trim() || 'the review question';
  return `To summarize source-backed evidence on ${topic}.`;
}

// An abstract is substantive only when its core fields carry real content; a
// blank or near-blank parse falls back to the deterministic abstract.
export function isSubstantiveAbstract(abstract: Manuscript['abstract']): boolean {
  const core = [abstract.background, abstract.results, abstract.conclusions].map((field) => field.trim());
  if (core.some((field) => field.length === 0)) return false;
  const words = Object.values(abstract).join(' ').split(/\s+/).filter(Boolean).length;
  return words >= 40;
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

export async function compileManuscriptFromLedger(opts: PaperLedgerPrep): Promise<Manuscript> {
  if (opts.signal?.aborted) throw new Error('Run stopped by user');
  opts.onStage?.('Drafting');
  // Run-scoped budget shared across every section and the QA-repair phase: once a
  // call exhausts its rate-limit retries, the rest of the run stops spending
  // optional expansion calls (5c) and ships clean shorter drafts.
  const budget = { rateLimited: false };
  let sections = await compileSections({
    question: opts.question,
    bossModel: opts.bossModel,
    specialists: opts.specialists,
    evidence: opts.evidence,
    extractions: opts.evidenceExtractions,
    claimLedger: opts.claimLedger,
    paperBlueprint: opts.paperBlueprint,
    ...(opts.dataset ? { dataset: opts.dataset } : {}),
    ...(opts.evidenceGap ? { evidenceGap: opts.evidenceGap } : {}),
    mini: opts.mini ?? false,
    budget,
    ...(opts.onStage ? { onStage: opts.onStage } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  // Deterministically drop any inline marker beyond the approved claim ledger, so
  // the export gate never hard-blocks on an over-cited [S#] the QA pass would have
  // had to fix with a (rate-limitable) model call.
  const approvedMarkers = new Set(opts.claimLedger.flatMap((entry) => entry.supportingSources));
  sections = stripUnapprovedMarkers(sections, approvedMarkers);
  // Remove near-verbatim paragraphs repeated ACROSS sections (a real run shipped
  // the same "Alzheimer's disease is the leading cause of dementia…" paragraph in
  // the Introduction, Mechanistic, and Discussion). Runs before the abstract so it
  // keys off the de-duplicated body.
  sections = dedupeAcrossSections(sections);
  const abstract = await draftAbstract({
    model: opts.bossModel,
    title: opts.paperBlueprint.title,
    question: opts.question,
    evidence: opts.evidence,
    sections,
    claimLedger: opts.claimLedger,
    extractions: opts.evidenceExtractions,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  let manuscript: Manuscript = {
    title: opts.paperBlueprint.title,
    abstract,
    keywords: keywordsFrom(titleTopic(opts.question)),
    sections,
  };
  let qa = validatePaperPackage({
    manuscript,
    evidenceExtractions: opts.evidenceExtractions,
    claimLedger: opts.claimLedger,
    paperBlueprint: opts.paperBlueprint,
    repairPass: 0,
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

  // Multi-pass QA repair with graceful degradation
  for (let repairPass = 1; repairPass <= MAX_QA_REPAIR_PASSES; repairPass += 1) {
    if (opts.signal?.aborted) throw new Error('Run stopped by user');
    const repairTargets = repairableSectionNames(manuscript.publication?.validation.blockers ?? []);
    if (repairTargets.length === 0) break;
    opts.onStage?.(`QA repair (pass ${repairPass})`);
    const sectionMap = new Map<string, string[]>(repairTargets.map((heading) => [heading, []]));
    const repaired = await compileSections({
      question: opts.question,
      bossModel: opts.bossModel,
      specialists: opts.specialists,
      evidence: opts.evidence,
      extractions: opts.evidenceExtractions,
      claimLedger: opts.claimLedger,
      paperBlueprint: opts.paperBlueprint,
      ...(opts.dataset ? { dataset: opts.dataset } : {}),
      ...(opts.evidenceGap ? { evidenceGap: opts.evidenceGap } : {}),
      mini: opts.mini ?? false,
      budget,
      ...(opts.onStage ? { onStage: opts.onStage } : {}),
      repairTargets: sectionMap,
      existingSections: sections,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const repairedNames = new Set(repairTargets);
    sections = sections.map((section) => (repairedNames.has(section.heading) ? repaired.find((candidate) => candidate.heading === section.heading) ?? section : section));
    // Re-strip: a repaired section may re-introduce an over-cited marker.
    sections = stripUnapprovedMarkers(sections, approvedMarkers);
    // Reuse the abstract drafted before the loop rather than re-drafting it every
    // pass — QA repairs are citation/depth fixes that do not change the abstract's
    // claims, so a per-pass re-draft was up to two wasted model calls per paper.
    manuscript = {
      title: opts.paperBlueprint.title,
      abstract,
      keywords: keywordsFrom(titleTopic(opts.question)),
      sections,
    };
    qa = validatePaperPackage({
      manuscript,
      evidenceExtractions: opts.evidenceExtractions,
      claimLedger: opts.claimLedger,
      paperBlueprint: opts.paperBlueprint,
      repairPass,
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

  // WS-11: never ship an incomplete draft silently — attach a visible banner.
  return withIncompleteDraftBanner(manuscript);
}

/** When a manuscript was finalized incomplete — residual validation blockers
 *  (graceful degradation under rate-limiting) or a section that could not be
 *  drafted — prepend a clearly-marked banner to the first section so the warning
 *  travels inside the document into every export, not just the execution trace.
 *  A complete manuscript is returned unchanged. Idempotent. */
export function withIncompleteDraftBanner(manuscript: Manuscript): Manuscript {
  const notExportReady = manuscript.publication?.validation.exportReady === false;
  const flaggedSections = manuscript.sections.filter((section) =>
    section.body.some((paragraph) => paragraph.startsWith(SECTION_REVIEW_FLAG)),
  ).length;
  const first = manuscript.sections[0];
  if (!(notExportReady || flaggedSections > 0) || !first || first.body[0]?.startsWith(INCOMPLETE_DRAFT_BANNER)) {
    return manuscript;
  }
  const detail =
    flaggedSections > 0
      ? ` ${flaggedSections} section${flaggedSections === 1 ? '' : 's'} could not be fully drafted.`
      : '';
  const banner = `${INCOMPLETE_DRAFT_BANNER} — this manuscript was finalized with unresolved quality checks, commonly caused by provider rate-limiting during drafting.${detail} Review the flagged content and re-run on a less rate-limited provider (or set the boss model to Auto) for a complete draft before any use.`;
  return {
    ...manuscript,
    sections: [{ ...first, body: [banner, ...first.body] }, ...manuscript.sections.slice(1)],
  };
}

export interface PaperLedgerPrep {
  question: string;
  bossModel: string;
  evidence: EvidenceItem[];
  specialists: SpecialistResult[];
  evidenceExtractions: EvidenceExtraction[];
  claimLedger: ClaimLedgerEntry[];
  paperBlueprint: PaperBlueprint;
  overrideTitle?: string | undefined;
  standard?: ManuscriptStandard | undefined;
  dataset?: UploadedDatasetSummary | null | undefined;
  evidenceGap?: string | undefined;
  mini?: boolean | undefined;
  onStage?: ((stage: string) => void) | undefined;
  signal?: AbortSignal;
}

/** Blocking phase: title generation, evidence extraction, claim ledger build,
 *  and optional user claim-review. Returns everything needed for drafting. */
export async function preparePaperLedger(opts: {
  question: string;
  bossModel: string;
  evidence: EvidenceItem[];
  specialists: SpecialistResult[];
  standard?: ManuscriptStandard;
  dataset?: UploadedDatasetSummary | null;
  onStage?: (stage: string) => void;
  evidenceGap?: string;
  mini?: boolean;
  onClaimLedger?: (ledger: ClaimLedgerEntry[]) => Promise<ClaimLedgerEntry[]>;
  signal?: AbortSignal;
}): Promise<PaperLedgerPrep> {
  if (opts.signal?.aborted) throw new Error('Run stopped by user');
  // Generate a focused academic title before building the blueprint so the
  // manuscript title is a proper journal-style heading rather than a generic prefix.
  opts.onStage?.('Title');
  // Prefer the user's explicit title verbatim; only ask the model to draft one
  // when none was given, which also avoids the model truncating a long title.
  let overrideTitle: string | undefined = extractExplicitTitle(opts.question);
  if (!overrideTitle) try {
    const reply = await callModel(
      opts.bossModel,
      'You write concise, formal academic manuscript titles for peer-reviewed journals. Reply with the title only — no quotation marks, no extra text, no explanation.',
      `Write a manuscript title for a ${opts.dataset ? 'original-dataset' : 'evidence-review'} biomedical manuscript addressing: ${opts.question}`,
      150,
      opts.mini ?? false,
      opts.signal,
    );
    const candidate = (reply.split('\n')[0] ?? '')
      .replace(/^[#\s"']+|[#\s"']+$/g, '')
      // Strip a leaked "Title:" label the model sometimes prepends, so the
      // manuscript title is the heading itself, not the word "Title".
      .replace(/^title\s*:\s*/i, '')
      .trim();
    // Reject a title that was cut off mid-stream (a rate-limit / provider drop
    // truncated one run to "Direct Oral Ant"): a real journal title is at least a
    // few words, so anything shorter falls back to the deterministic blueprint
    // title rather than shipping a broken heading.
    if (
      candidate.length >= 20 &&
      candidate.length <= 200 &&
      candidate.split(/\s+/).filter(Boolean).length >= 4 &&
      !/^title$/i.test(candidate) &&
      !/\b(write|draft|generate|manuscript topic|section to write)\b/i.test(candidate)
    ) {
      overrideTitle = candidate;
    }
  } catch {
    /* keep the blueprintTitle fallback */
  }

  opts.onStage?.('Extracting');
  resetSyntheticIds();
  const recordExtractions = extractEvidenceFromRecords(opts.evidence);
  const promptRows = parsePromptEffectRows(opts.question);
  const syntheticExtractions =
    promptRows.length >= 2 ? toSyntheticExtractions(promptRows) : [];
  const evidenceExtractions = [...syntheticExtractions, ...recordExtractions];
  opts.onStage?.('Building claims');
  let claimLedger = buildClaimLedger(evidenceExtractions);
  if (opts.onClaimLedger) {
    opts.onStage?.('Awaiting claim review');
    claimLedger = await opts.onClaimLedger(claimLedger);
  }
  const paperBlueprint = buildPaperBlueprint(opts.question, claimLedger, overrideTitle, opts.mini ?? false);
  return {
    question: opts.question,
    bossModel: opts.bossModel,
    evidence: opts.evidence,
    specialists: opts.specialists,
    evidenceExtractions,
    claimLedger,
    paperBlueprint,
    overrideTitle,
    ...(opts.standard ? { standard: opts.standard } : {}),
    ...(opts.dataset ? { dataset: opts.dataset } : {}),
    ...(opts.evidenceGap ? { evidenceGap: opts.evidenceGap } : {}),
    mini: opts.mini ?? false,
    onStage: opts.onStage,
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
}
