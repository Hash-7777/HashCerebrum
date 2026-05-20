import type { EvidenceItem } from '@platform/index';
import type { SpecialistResult, SpecialistTask } from './types';

export type PaperStandard = 'imrad_review' | 'prisma_review' | 'consort_trial' | 'strobe_observational' | 'care_case';

export interface PaperRequest {
  standard: PaperStandard;
  label: string;
}

const PAPER_RX = /\b(full\s+)?(research\s+paper|manuscript|journal\s+article|publishable|publication|write\s+a\s+paper|draft\s+a\s+paper)\b/i;

export function detectPaperRequest(question: string): PaperRequest | null {
  if (!PAPER_RX.test(question)) return null;
  if (/\b(systematic\s+review|meta[-\s]?analysis|prisma)\b/i.test(question)) {
    return { standard: 'prisma_review', label: 'PRISMA-style evidence review manuscript' };
  }
  if (/\b(randomi[sz]ed|trial|consort)\b/i.test(question)) {
    return { standard: 'consort_trial', label: 'CONSORT-aware trial report draft' };
  }
  if (/\b(cohort|case[-\s]?control|cross[-\s]?sectional|observational|strobe)\b/i.test(question)) {
    return { standard: 'strobe_observational', label: 'STROBE-aware observational manuscript' };
  }
  if (/\b(case\s+report|care\s+guideline)\b/i.test(question)) {
    return { standard: 'care_case', label: 'CARE-aware case-report manuscript' };
  }
  return { standard: 'imrad_review', label: 'IMRaD narrative review manuscript' };
}

export function fallbackPaperTasks(question: string): SpecialistTask[] {
  const tasks: SpecialistTask[] = [
    {
      agentId: 'literature',
      subQuery: `Summarize peer-reviewed evidence for this manuscript topic: ${question}`,
    },
    {
      agentId: 'pharmacology',
      subQuery: `Explain pharmacology, mechanisms, interactions, adverse effects, and drug-safety signals for: ${question}`,
    },
    {
      agentId: 'trials',
      subQuery: `Find clinical trials, large cohorts, and registered studies relevant to: ${question}`,
    },
    {
      agentId: 'public_health',
      subQuery: `Summarize epidemiology, population risk, clinical impact, and prevention guidance for: ${question}`,
    },
  ];

  if (/\b(dental|dentistry|oral|periodontal|teeth|gum)\b/i.test(question)) {
    tasks[1] = {
      agentId: 'dentistry',
      subQuery: `Summarize dental and oral-health evidence relevant to: ${question}`,
    };
  }
  return tasks;
}

export function paperSystemInstruction(request: PaperRequest): string {
  return `Write a full source-grounded biomedical manuscript draft using the ${request.label} form.

Use journal-manuscript structure, not a short answer. Follow the closest EQUATOR-style reporting family:
- IMRaD for narrative evidence reviews.
- PRISMA-style search/reporting language for review requests.
- CONSORT-aware structure for trial-report requests.
- STROBE-aware structure for observational/cohort requests.
- CARE-aware structure for case-report requests.

Required sections:
1. Title
2. Structured Abstract: Background, Objective, Methods, Results, Conclusions
3. Keywords
4. Introduction
5. Methods: design, data sources, search strategy, eligibility criteria, extraction/synthesis approach
6. Results: evidence map, source yield, major findings, safety/outcome findings
7. Discussion: interpretation, clinical/research implications, uncertainty
8. Limitations
9. Conclusion
10. Declarations: ethics, funding, conflicts of interest, data availability
11. References

Hard rules:
- Use only retrieved records and specialist findings supplied below.
- Cite factual claims with [S#] markers.
- Never invent authors, PMIDs, DOIs, years, statistics, trial outcomes, or guidelines.
- If evidence is insufficient for a publishable conclusion, write that limitation plainly.
- This is a manuscript draft for expert review, not medical advice and not a guaranteed publishable paper.`;
}

function evidenceLine(record: EvidenceItem, index: number): string {
  const year = record.year ? ` (${record.year})` : '';
  const id = record.identifiers?.pmid
    ? ` PMID:${record.identifiers.pmid}`
    : record.identifiers?.doi
      ? ` DOI:${record.identifiers.doi}`
      : '';
  const snippet = record.snippet ? ` ${record.snippet.replace(/\s+/g, ' ').slice(0, 260)}` : '';
  return `[S${index + 1}] ${record.source.toUpperCase()}${year}. ${record.title}.${id}${snippet}`;
}

function sourceYield(evidence: EvidenceItem[]): string {
  const counts = new Map<EvidenceItem['source'], number>();
  for (const item of evidence) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([source, count]) => `${source}: ${count}`)
    .join('; ') || 'no records';
}

export function buildSourceGroundedPaperFallback(
  question: string,
  request: PaperRequest,
  evidence: EvidenceItem[],
  specialists: SpecialistResult[],
  reason: string,
): string {
  const references = evidence.slice(0, 24).map(evidenceLine).join('\n') || 'No citable source records were retrieved.';
  const findings = specialists
    .map((specialist) => {
      const note = specialist.error
        ? `failed or incomplete: ${specialist.error}`
        : specialist.findings.trim() || `retrieved ${specialist.evidence.length} record(s)`;
      return `- ${specialist.label}: ${note}`;
    })
    .join('\n');

  return `# Manuscript Draft

## Title
Evidence Review: ${question}

## Structured Abstract
**Background:** The user requested a full manuscript on ${question}. Source agents retrieved ${evidence.length} citable record(s) across ${sourceYield(evidence)}.
**Objective:** To draft a source-grounded manuscript outline and evidence synthesis using only records retrieved during this run.
**Methods:** HashCerebrum delegated the topic to specialist agents, searched guarded biomedical sources, de-duplicated records, and prepared this ${request.label}. The boss synthesis model failed before drafting the final manuscript: ${reason}
**Results:** Retrieved records support a structured evidence map, but the final interpretation remains limited because model synthesis failed. The strongest available source details are listed in References.
**Conclusions:** This fallback manuscript is source triage, not a submission-ready article. A connected synthesis model should regenerate the paper to complete the narrative, citation alignment, and journal polish.

## Keywords
${question}; evidence review; biomedical manuscript; source-grounded synthesis

## Introduction
This draft addresses ${question}. The evidence base was assembled from guarded medical sources and should be interpreted as a source-grounded starting point for expert review.

## Methods
### Design
Automated source-triage manuscript draft using a ${request.label} structure.

### Data Sources
The run queried available biomedical source agents. Source yield: ${sourceYield(evidence)}.

### Eligibility And Extraction
Records returned by the source agents were treated as candidate evidence. Titles, snippets, years, identifiers, and source provenance were retained for citation discipline.

### Synthesis
Specialist findings were intended to be synthesized by the boss agent. Because synthesis failed, this fallback preserves the evidence and specialist status without inventing unsupported conclusions.

## Results
### Search Yield
${evidence.length} source record(s) were retrieved.

### Specialist Findings
${findings || 'No specialist findings were available.'}

### Evidence Map
${references}

## Discussion
The available records can support a full manuscript draft once a working synthesis model is available. Until then, this fallback should be used to inspect source coverage, identify missing evidence, and decide whether the topic needs a narrower question, more database coverage, or manual expert review.

## Limitations
- The boss synthesis step failed, so narrative interpretation is intentionally conservative.
- Retrieved snippets may not contain all clinically relevant details.
- No claims beyond the listed source records should be treated as established.

## Conclusion
HashCerebrum retrieved source evidence for ${question}, but could not complete the final manuscript synthesis. Regenerate after selecting a working model/provider to produce the full publishable-style draft.

## Declarations
**Ethics:** No human-subject data were collected by this app run.
**Funding:** Not specified.
**Conflicts of Interest:** Not specified.
**Data Availability:** Source records are listed in the Evidence panel and References section.

## References
${references}`;
}
