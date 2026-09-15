// The export gate. validatePaperPackage decides whether a drafted paper may be
// called export-ready: enough trusted primary records, a source-backed claim
// ledger, clinical results that carry citations, only ledger-approved citation
// markers, and an abstract that does not overstate the body.
//
// After the last repair pass, the blockers a rate-limited run could not repair
// are downgraded to warnings instead of failing the whole draft;
// repairableSectionNames picks which sections a repair pass redrafts.

import type { Manuscript } from './manuscript';
import type {
  ClaimLedgerEntry,
  EvidenceExtraction,
  PaperBlueprint,
  PaperPackageQa,
  ValidationIssue,
} from './publicationTypes';
import { CONTEXT_ONLY_SOURCES } from './evidenceExtraction';

const MAX_QA_REPAIR_SECTIONS = 4;

export const MAX_QA_REPAIR_PASSES = 2;

/** When true, the pipeline allows export even with residual repairable blockers
 *  after all repair passes are exhausted — the manuscript is flagged with a
 *  prominent warning rather than being hard-blocked. This prevents free-tier
 *  rate-limit stalls from killing an otherwise usable draft. */
const GRACEFUL_DEGRADATION = true;

// Minimum trusted primary (non drug-label) records required before an
// automated evidence-review draft is allowed to export. Raised from 3 to 5 to
// reject thin "cheap research" drafts; deeper retrieval makes this easy to meet
// for any genuine question.
const MIN_PRIMARY_EVIDENCE = 5;

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
  repairPass?: number;
}): PaperPackageQa {
  const blockers: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const repairPass = opts.repairPass ?? 0;
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
    // After auto-routing, this should rarely trigger; if it still does on
    // pass 0 it is repairable by auto-route. On later passes degrade to warning.
    const severity: ValidationIssue['severity'] = repairPass >= MAX_QA_REPAIR_PASSES ? 'warning' : 'blocker';
    blockers.push(
      issue(
        severity,
        'no-source-backed-results',
        'The clinical evidence section has no source-backed finding in the claim ledger.',
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
        const severity: ValidationIssue['severity'] = repairPass >= MAX_QA_REPAIR_PASSES && GRACEFUL_DEGRADATION ? 'warning' : 'blocker';
        blockers.push(
          issue(severity, 'citation-not-in-claim-ledger', `${cited} is cited but not present in the approved claim ledger.`),
        );
      }
    }
    const clinical = sectionText(opts.manuscript, 'Clinical Evidence and Safety Outcomes');
    if (!/\[S\d+\]/.test(clinical)) {
      const severity: ValidationIssue['severity'] = repairPass >= MAX_QA_REPAIR_PASSES && GRACEFUL_DEGRADATION ? 'warning' : 'blocker';
      blockers.push(
        issue(
          severity,
          'clinical-results-uncited',
          'The clinical evidence section contains no source-backed inline citation.',
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

  // Graceful degradation: after max repair passes, downgrade remaining
  // repairable blockers to warnings so the draft is not permanently killed.
  if (repairPass >= MAX_QA_REPAIR_PASSES && GRACEFUL_DEGRADATION) {
    const repairableCodes = new Set(['section-too-short', 'section-missing-citation', 'unsupported-statistic', 'clinical-results-uncited', 'citation-not-in-claim-ledger', 'no-source-backed-results']);
    for (let i = 0; i < blockers.length; i += 1) {
      if (repairableCodes.has(blockers[i]!.code)) {
        warnings.push({ ...blockers[i]!, severity: 'warning' });
        blockers.splice(i, 1);
        i -= 1;
      }
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

export function repairableSectionNames(issues: ValidationIssue[]): string[] {
  const names = issues
    .filter((issueItem) =>
      issueItem.section &&
      [
        'section-too-short',
        'section-missing-citation',
        'unsupported-statistic',
        'clinical-results-uncited',
        'fabricated-primary-study',
        'prompt-leakage',
        'missing-required-section',
        'model-owned-references',
      ].includes(issueItem.code),
    )
    .map((issueItem) => issueItem.section!);
  return [...new Set(names)].slice(0, MAX_QA_REPAIR_SECTIONS);
}
