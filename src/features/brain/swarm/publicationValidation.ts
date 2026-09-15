// Validation of an assembled manuscript: required sections and their depth,
// citations that resolve to retrieved records, statistics the cited evidence
// supports, claims that do not contradict each other, no fabricated primary
// study and no leaked prompt text — plus the compliance checklist and the
// merge with the paper pipeline's own QA.
//
// Its verdict becomes the artifact's exportReady flag.

import type { EvidenceItem } from '@platform/index';
import {
  containsPromptLeakage,
  SECTION_PLAN,
  type Manuscript,
  type ManuscriptSection,
} from './manuscript';
import type {
  CanonicalReference,
  ComplianceItem,
  EvidenceExtraction,
  ManuscriptStandard,
  ManuscriptValidation,
  PaperPackageQa,
  StatisticsPayload,
  UploadedDatasetSummary,
  ValidationIssue,
} from './publicationTypes';
import { buildEvidenceMeta } from './metaAnalysis';
import { citedSourceNumbers } from './publicationReferences';

const SECTION_CITATION_EXEMPT = new Set([
  'Declarations',
  'Dataset and Statistical Analysis',
  'Figures, Tables, and Statistical Safeguards',
  // Methods is generated deterministically from the fixed pipeline description
  // (buildMethodsSection) and cites no findings, so it carries no [S#] markers.
  'Methods',
]);

function words(value: string): number {
  return value.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length;
}

export function hasReferenceSection(section: ManuscriptSection): boolean {
  return /^(references|bibliography|works cited)$/i.test(section.heading.trim());
}

function evidenceText(
  evidence: EvidenceItem[],
  dataset?: UploadedDatasetSummary,
  extractions?: EvidenceExtraction[],
): string {
  const datasetText = dataset
    ? [
        dataset.filename,
        dataset.sha256,
        dataset.rows,
        ...dataset.columns,
        ...dataset.columnSummaries.flatMap((column) => [
          column.name,
          column.nonMissing,
          column.missing,
          column.mean,
          column.sd,
          column.median,
          column.min,
          column.max,
          ...(column.levels?.flatMap((level) => [level.value, level.count]) ?? []),
        ]),
      ].filter(Boolean).join(' ')
    : '';
  // Every number the validated inferential engine computed is "supported":
  // the report sentences carry the formatted estimates, CIs, and p-values.
  const inferential = dataset?.inferential;
  const inferentialText = inferential
    ? [
        ...inferential.analyses.map((analysis) => analysis.reportText),
        inferential.subgroups?.reportText ?? '',
        ...(inferential.subgroups?.rows.map(
          (row) => `${row.oddsRatio} ${row.ciLow} ${row.ciHigh}`,
        ) ?? []),
        inferential.survival?.reportText ?? '',
      ].join(' ')
    : '';
  const extractionText = extractions
    ? extractions
        .flatMap((item) => [
          item.sampleSize ?? '',
          ...item.effectValues.flatMap((effect) => [effect.value, effect.sourceText]),
          item.keyFinding,
        ])
        .join(' ')
    : '';
  return evidence
    .map((record) => [record.title, record.snippet, record.year, record.identifiers?.doi, record.identifiers?.pmid].filter(Boolean).join(' '))
    .concat([datasetText, inferentialText, extractionText])
    .join(' ')
    .toLowerCase();
}

function unsupportedStatisticIssues(
  manuscript: Manuscript,
  evidence: EvidenceItem[],
  dataset?: UploadedDatasetSummary,
  extractions?: EvidenceExtraction[],
): ValidationIssue[] {
  const supportedText = evidenceText(evidence, dataset, extractions);
  // Also include meta-analysis computed values as supported
  const meta = extractions ? buildEvidenceMeta(extractions) : undefined;
  const metaText = meta?.interpretable
    ? [
        String(meta.pooledPoint),
        String(meta.ciLow),
        String(meta.ciHigh),
        String(meta.i2),
        String(meta.tau2),
        String(meta.qStatistic),
      ].join(' ')
    : '';
  const fullSupported = `${supportedText} ${metaText}`;
  const rx =
    /\b(?:p\s*[<=>]\s*0?\.\d+|(?:hazard ratio|odds ratio|risk ratio|relative risk|hr|or|rr)\s*(?:=|of|:)?\s*\d+(?:\.\d+)?|95%\s*ci\s*[:(]?\s*\d+(?:\.\d+)?\s*(?:-|–|to|,)\s*\d+(?:\.\d+)?)/gi;
  const issues: ValidationIssue[] = [];
  for (const section of manuscript.sections) {
    for (const match of section.body.join(' ').matchAll(rx)) {
      const claim = match[0];
      const numbers = claim.match(/\d+(?:\.\d+)?/g) ?? [];
      const supported = numbers.length > 0 && numbers.every((n) => fullSupported.includes(n.toLowerCase()));
      if (!supported) {
        issues.push({
          severity: 'blocker',
          code: 'unsupported-statistic',
          section: section.heading,
          message: `Statistical claim "${claim}" is not traceable to retrieved evidence or computed statistics.`,
        });
      }
    }
  }
  return issues;
}

function claimConsistencyIssues(manuscript: Manuscript): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scarcityRx = /\b(no|little|limited|insufficient|thin|indirect)\s+(direct\s+)?evidence\b/i;
  const strengthRx = /\b(strong|definitive|conclusive|clear|established|proven)\s+evidence\b/i;
  const safetyRx = /\b(no\s+(meaningful\s+)?risk|safe|safety\s+is\s+established|rules\s+out)\b/i;
  const riskRx = /\b(risk|harm|bleeding|toxicity|adverse|signal|warning)\b/i;

  for (const section of manuscript.sections) {
    const text = section.body.join(' ');
    if (scarcityRx.test(text) && strengthRx.test(text)) {
      issues.push({
        severity: 'warning',
        code: 'claim-consistency-scarcity-strength',
        section: section.heading,
        message: `${section.heading} mixes evidence-scarcity language with strong-evidence language; expert review should confirm the interpretation.`,
      });
    }
    if (safetyRx.test(text) && riskRx.test(text)) {
      issues.push({
        severity: 'warning',
        code: 'claim-consistency-safety-risk',
        section: section.heading,
        message: `${section.heading} contains both safety-assurance and risk-signal wording; the final conclusion may need tighter qualification.`,
      });
    }
  }

  return issues;
}

// Detect the model fabricating an original primary study. This tool only
// reviews retrieved literature, so first-person "we conducted a cohort /
// enrolled patients / used EHR / applied propensity-score matching" language
// is a hallucination that must never reach a reader of a medical document.
function fabricatedPrimaryStudyIssues(manuscript: Manuscript): ValidationIssue[] {
  const fabricationRx =
    /\b(a\s+(retrospective|prospective)\s+cohort\s+study\s+was\s+conducted|we\s+(conducted|enrolled|recruited|anal\w+|performed\s+a\s+(cohort|study))|electronic\s+health\s+records?\s+(were|was)|propensity[-\s]?score\s+match|our\s+(cohort|study\s+population|analysis\s+of\s+patients)|patients\s+were\s+(enrolled|recruited|randomi[sz]ed))\b/i;
  const issues: ValidationIssue[] = [];
  const abstractText = Object.values(manuscript.abstract).filter(Boolean).join(' ');
  if (fabricationRx.test(abstractText)) {
    issues.push({
      severity: 'blocker',
      code: 'fabricated-primary-study',
      section: 'Abstract',
      message:
        'The abstract describes original data collection (a conducted cohort / enrolled patients / EHR / propensity matching). This is an automated literature review — that methodology is fabricated and must be removed.',
    });
  }
  for (const section of manuscript.sections) {
    if (fabricationRx.test(section.body.join(' '))) {
      issues.push({
        severity: 'blocker',
        code: 'fabricated-primary-study',
        section: section.heading,
        message: `${section.heading} claims original data collection (conducted study / enrolled patients / EHR / propensity matching), which is fabricated for an automated literature review and must be rewritten as a description of the retrieved evidence.`,
      });
    }
  }
  return issues;
}

function promptLeakageIssues(manuscript: Manuscript): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (containsPromptLeakage(manuscript.title)) {
    issues.push({
      severity: 'blocker',
      code: 'prompt-leakage',
      message: 'The title contains prompt or instruction text and must be regenerated.',
    });
  }
  // Scan the abstract fields too — they are model-generated and just as prone
  // to leaking system-prompt text as the body sections.
  const abstractText = Object.values(manuscript.abstract).filter(Boolean).join('\n\n');
  if (containsPromptLeakage(abstractText)) {
    issues.push({
      severity: 'blocker',
      code: 'prompt-leakage',
      section: 'Abstract',
      message: 'The abstract contains prompt or instruction text and must be regenerated.',
    });
  }
  for (const section of manuscript.sections) {
    const text = section.body.join('\n\n');
    if (containsPromptLeakage(text)) {
      issues.push({
        severity: 'blocker',
        code: 'prompt-leakage',
        section: section.heading,
        message: `${section.heading} contains prompt or instruction text and must be regenerated.`,
      });
    }
  }
  return issues;
}

export function validateManuscript(
  manuscript: Manuscript,
  evidence: EvidenceItem[],
  references: CanonicalReference[],
  dataset?: UploadedDatasetSummary,
  extractions?: EvidenceExtraction[],
): ManuscriptValidation {
  const issues: ValidationIssue[] = [];
  const wordCounts: Record<string, number> = {};
  const cited = citedSourceNumbers(manuscript);
  const citedSet = new Set(cited);
  const sectionPlan = new Map(SECTION_PLAN.map((spec) => [spec.heading, spec]));
  const presentSections = new Set(manuscript.sections.map((section) => section.heading));

  if (!manuscript.title.trim()) {
    issues.push({ severity: 'blocker', code: 'missing-title', message: 'The manuscript has no title.' });
  }

  for (const number of cited) {
    if (!evidence[number - 1]) {
      issues.push({
        severity: 'blocker',
        code: 'unresolved-citation',
        message: `[S${number}] does not resolve to a retrieved evidence record.`,
      });
    }
  }

  if (evidence.length > 0 && cited.length === 0) {
    issues.push({
      severity: 'blocker',
      code: 'no-citations',
      message: 'The manuscript contains retrieved evidence but no inline source citations.',
    });
  }

  for (const spec of SECTION_PLAN) {
    if (!presentSections.has(spec.heading)) {
      issues.push({
        severity: 'blocker',
        code: 'missing-required-section',
        section: spec.heading,
        message: `Required section "${spec.heading}" is missing.`,
      });
    }
  }

  for (const section of manuscript.sections) {
    const count = words(section.body.join(' '));
    wordCounts[section.heading] = count;
    const spec = sectionPlan.get(section.heading);
    if (spec && count < spec.minWords) {
      issues.push({
        severity: 'blocker',
        code: 'section-too-short',
        section: section.heading,
        message: `${section.heading} is ${count} words; required minimum is ${spec.minWords}.`,
      });
    }
    if (!SECTION_CITATION_EXEMPT.has(section.heading) && !/\[(?:S)?\d+\]/.test(section.body.join(' '))) {
      issues.push({
        severity: 'blocker',
        code: 'section-missing-citation',
        section: section.heading,
        message: `${section.heading} has no inline source citation.`,
      });
    }
    if (hasReferenceSection(section)) {
      issues.push({
        severity: 'blocker',
        code: 'model-owned-references',
        section: section.heading,
        message: 'References must be renderer-owned, not model-written body sections.',
      });
    }
  }

  issues.push(...unsupportedStatisticIssues(manuscript, evidence, dataset, extractions));
  issues.push(...claimConsistencyIssues(manuscript));
  issues.push(...fabricatedPrimaryStudyIssues(manuscript));
  issues.push(...promptLeakageIssues(manuscript));

  if (references.length === 0 && citedSet.size > 0) {
    issues.push({
      severity: 'blocker',
      code: 'reference-resolution-empty',
      message: 'Inline citations were found, but no canonical references could be resolved.',
    });
  }

  if (references.length < citedSet.size) {
    issues.push({
      severity: 'warning',
      code: 'deduplicated-references',
      message: `${citedSet.size} inline source markers resolve to ${references.length} deduplicated reference(s).`,
    });
  }

  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  return {
    exportReady: blockers.length === 0,
    blockers,
    warnings: issues.filter((issue) => issue.severity === 'warning'),
    wordCounts,
    citationCount: citedSet.size,
    referenceCount: references.length,
  };
}

export function compliance(standard: ManuscriptStandard, validation: ManuscriptValidation, stats: StatisticsPayload): ComplianceItem[] {
  return [
    {
      id: 'citation-resolution',
      label: 'Every inline citation resolves to canonical evidence',
      status: validation.blockers.some((issue) => issue.code === 'unresolved-citation') ? 'blocker' : 'pass',
      detail: `${validation.citationCount} inline citation marker(s), ${validation.referenceCount} canonical reference(s).`,
    },
    {
      id: 'section-depth',
      label: 'Required manuscript sections meet minimum depth',
      status: validation.blockers.some((issue) => issue.code === 'section-too-short') ? 'blocker' : 'pass',
      detail: 'Section word counts are checked before export.',
    },
    {
      id: 'statistics-safety',
      label: 'No model-invented statistical analysis',
      status: validation.blockers.some((issue) => issue.code === 'unsupported-statistic') ? 'blocker' : 'pass',
      detail: stats.safeguards[0] ?? 'Statistics safeguards active.',
    },
    {
      id: 'journal-template',
      label: `${standard.replace(/_/g, ' ').toUpperCase()} export template selected`,
      status: 'pass',
      detail: 'The structured artifact can be rendered through the selected manuscript style.',
    },
  ];
}

export function validationWithPaperQa(validation: ManuscriptValidation, paperQa?: PaperPackageQa): ManuscriptValidation {
  if (!paperQa) return validation;
  const blockers = [...validation.blockers, ...paperQa.blockers];
  const warnings = [...validation.warnings, ...paperQa.warnings];
  return {
    ...validation,
    blockers,
    warnings,
    exportReady: blockers.length === 0,
  };
}
