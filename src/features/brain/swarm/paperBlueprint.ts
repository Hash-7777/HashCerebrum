// The plan a paper follows before any prose exists: its title, its sections,
// and which ledger claims and source markers each section must cover.
//
// A section that has to be earned by evidence is dropped when no claim targets
// it, so the model is never asked to write — and invent citations for — a
// section the retrieval did not support. buildPaperOutline gives the UI the
// same plan with no model call, so scope can be previewed before a run starts.

import { SECTION_PLAN, type SectionSpec } from './manuscript';
import type { ClaimLedgerEntry, PaperBlueprint } from './publicationTypes';
import { titleTopic } from './paperTitle';

const MAX_LEDGER_CLAIMS_PER_SECTION = 12;

// Topic-specific sections that must be earned by evidence. If the retrieval
// produced no claim that actually targets one of these, the section is dropped
// rather than padded with unrelated claims — which is how a pharmacology-free
// asthma-education topic ended up with a fabricated PK/PD section the model
// "supported" with citations to pharmacist-intervention papers.
const EVIDENCE_GATED_HEADINGS = new Set([
  'Mechanistic and Pharmacologic Evidence',
  'Trial and Registry Evidence',
]);

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

function ledgerById(ledger: ClaimLedgerEntry[]): Map<string, ClaimLedgerEntry> {
  return new Map(ledger.map((entry) => [entry.id, entry]));
}

export function claimsForBlueprintSection(section: PaperBlueprint['sections'][number], ledger: ClaimLedgerEntry[]): ClaimLedgerEntry[] {
  const byId = ledgerById(ledger);
  const direct = section.requiredClaimIds.map((id) => byId.get(id)).filter((entry): entry is ClaimLedgerEntry => Boolean(entry));
  if (direct.length > 0) return direct;
  return ledger.slice(0, Math.min(MAX_LEDGER_CLAIMS_PER_SECTION, ledger.length));
}
