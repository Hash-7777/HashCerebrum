// Writing the Methods section from what the run actually did.
//
// Methods is the one section a reader uses to judge whether the search was
// sound, so it is the one section that must never be improvised. Everything
// here is derived from the run itself — which databases were queried, how many
// records came back, what the study-design mix was, the retrieval date read off
// each record's own timestamp — and handed to the model as notes to expand
// rather than facts to invent.
//
// The date is the clearest case of the rule. `searchDatePhrase` returns an empty
// string when no record carries a usable timestamp, rather than reaching for
// today's date: a fabricated "searched on" line is worse than no line, because a
// reader cannot tell it is fabricated and it is exactly the kind of detail that
// makes a review look current when it is not.
//
// Methods is also citation-exempt by design. It describes the pipeline, not
// findings, so it carries no [S#] markers and the citation guards skip it.

import type { EvidenceItem } from '@platform/index';
import { buildEvidenceMeta } from './metaAnalysis';
import { titleTopic } from './paperTitle';
import type { EvidenceExtraction } from './publicationTypes';

// ── C5: deterministic Methods notes ─────────────────────────────────────────
// The Methods section must narrate the REAL pipeline, not a hallucinated one.
// These notes are injected into the Methods prompt so the model has exact
// sources, counts, query terms, and run date to expand — not invent.
export function deterministicMethodsNotes(
  question: string,
  evidence: EvidenceItem[],
  extractions: EvidenceExtraction[],
): string {
  const sourceCounts = new Map<string, number>();
  for (const e of evidence) {
    sourceCounts.set(e.source, (sourceCounts.get(e.source) ?? 0) + 1);
  }
  const sourceList = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s.replace(/_/g, ' ')} (${n})`)
    .join(', ');
  const uniqueRecords = evidence.length;
  const extractionCount = extractions.length;
  const runDate = new Date().toISOString().slice(0, 10);
  return (
    `SEARCHED: ${sourceList}. ` +
    `RETRIEVED: ${uniqueRecords} unique records. ` +
    `EXTRACTED: ${extractionCount} structured evidence items. ` +
    `QUERY: "${question.replace(/"/g, "'")}". ` +
    `RUN DATE: ${runDate}. ` +
    `DEDUPLICATION: by DOI or PMID, then by normalised title + publication year. ` +
    `ELIGIBILITY: biomedical records with a title and an abstract or structured metadata; no language filter.`
  );
}

const SOURCE_DISPLAY_NAME: Record<string, string> = {
  pubmed: 'PubMed/MEDLINE',
  europepmc: 'Europe PMC',
  openalex: 'OpenAlex',
  clinicaltrials: 'ClinicalTrials.gov',
  clinicaltrials_gov: 'ClinicalTrials.gov',
  openfda: 'openFDA',
  rxnorm: 'RxNorm',
  semantic_scholar: 'Semantic Scholar',
  gwas_catalog: 'GWAS Catalog',
  clinvar: 'ClinVar',
};
function displaySourceName(source: string): string {
  return SOURCE_DISPLAY_NAME[source] ?? source.replace(/_/g, ' ');
}

// Bucket a free-text study design into one reporting category, so the Methods can
// state the actual design mix of THIS review's evidence.
function classifyStudyDesign(design: string): string {
  const t = design.toLowerCase();
  if (/meta-analys|systematic review/.test(t)) return 'systematic reviews or meta-analyses';
  if (/random|\brct\b/.test(t)) return 'randomised controlled trials';
  if (/cohort|registry|prospective|retrospective|longitudinal/.test(t)) return 'cohort or registry studies';
  if (/case[-\s]control/.test(t)) return 'case-control studies';
  if (/cross[-\s]sectional|survey/.test(t)) return 'cross-sectional studies';
  if (/case (report|series)/.test(t)) return 'case reports or series';
  if (/guideline|regulatory|label|terminology/.test(t)) return 'regulatory or guideline records';
  return 'other indexed records';
}

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Deterministic Methods section for an automated evidence review (no uploaded
// dataset). It is generated in code — not by a model — so it never drifts into a
// conclusion, never reuses a sample size as a record count, is identical for the
// same run regardless of rate limits, and saves one model call on free-tier
// quotas. It is NOT a fixed template: the constant part honestly describes the
// pipeline (which really is the same each run), but the study-specific facts —
// the actual topic, the databases that CONTRIBUTED records and their counts, the
// real design mix, the outcomes tracked, and whether a pooled meta-analysis was
// computable for THIS evidence — are woven in from the retrieved records, so two
// different reviews produce genuinely different Methods. No inline [S#] citations
// (it describes the pipeline, not findings), hence 'Methods' is citation-exempt.
// The calendar date(s) on which the evidence was actually retrieved, read from each
// record's fetchedAt stamp — the standard "databases were searched on …" element a
// reader needs to judge currency. Returns a leading-space clause, or '' when no
// record carries a usable timestamp (never fabricates a date).
export function searchDatePhrase(evidence: EvidenceItem[]): string {
  const days = new Set<string>();
  for (const item of evidence) {
    const day = (item.fetchedAt ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) days.add(day);
  }
  if (days.size === 0) return '';
  const sorted = [...days].sort();
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return first === last
    ? `, searched on ${first}`
    : `, searched between ${first} and ${last}`;
}

export function buildMethodsSection(
  question: string,
  evidence: EvidenceItem[],
  extractions: EvidenceExtraction[],
  evidenceGap?: string,
): string[] {
  const topic = titleTopic(question) || 'the review question';

  // Databases that actually returned records, with counts, most-productive first.
  const sourceCounts = new Map<string, number>();
  for (const item of evidence) sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
  const sourceList = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `${displaySourceName(source)} (${count})`);
  const searchDate = searchDatePhrase(evidence);
  const sourcesSentence = sourceList.length
    ? `Evidence for this review comprised ${evidence.length} record(s) retrieved from ${joinList(sourceList)}${searchDate}.`
    : `Evidence for this review was retrieved from the pipeline's biomedical sources${searchDate}.`;

  // Actual study-design mix of the retrieved evidence.
  const designCounts = new Map<string, number>();
  for (const ex of extractions) {
    const bucket = classifyStudyDesign(ex.studyDesign);
    designCounts.set(bucket, (designCounts.get(bucket) ?? 0) + 1);
  }
  const designList = [...designCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([design, count]) => `${count} ${design}`);
  const designSentence = designList.length
    ? `Across the ${extractions.length} structured evidence item(s) extracted, the design mix comprised ${joinList(designList)}.`
    : 'The retrieved records were parsed into structured evidence items where sufficient metadata was present.';

  // Outcomes actually tracked across the evidence.
  const outcomeSet = new Set<string>();
  for (const ex of extractions) for (const outcome of ex.outcomes) if (outcome.trim()) outcomeSet.add(outcome.trim());
  const outcomes = [...outcomeSet].slice(0, 6);
  const outcomesSentence = outcomes.length
    ? `The outcomes tracked across the retrieved evidence included ${joinList(outcomes)}.`
    : '';

  // Whether a quantitative pooled meta-analysis was computable for THIS evidence.
  const metaComputable = buildEvidenceMeta(extractions)?.interpretable === true;
  const synthesisSentence = metaComputable
    ? 'Because at least two records reported a comparable effect measure with a confidence interval, an ' +
      'inverse-variance random-effects meta-analysis (DerSimonian–Laird) was computed in-app on the ' +
      'logarithmic scale and back-transformed for display, together with the I² heterogeneity statistic ' +
      'and a prediction interval; the pooled estimate and forest plot appear in the results, and the ' +
      'pooling is performed deterministically in code, independent of any language model.'
    : 'The retrieved records did not report enough comparable effect measures with confidence intervals ' +
      'to support a quantitative pooled meta-analysis, so the synthesis is narrative; where individual ' +
      'effect estimates were reported they are described with their source rather than pooled.';

  const paragraphs = [
    `This automated evidence review examined ${topic}. It is a source-grounded synthesis rather than a ` +
      'hand-curated systematic review conducted under formal PRISMA methodology: the question was ' +
      'decomposed into concept-scoped sub-queries — covering the population, the exposure or ' +
      'intervention, the comparator, and the outcomes of interest — and dispatched to a team of ' +
      'specialist agents that queried authoritative biomedical databases in parallel. Every outbound ' +
      'request passed through a guarded, allowlisted network layer and was recorded in a tamper-evident ' +
      'audit log, so the provenance of each retrieved record is reproducible. No manual literature ' +
      'screening, no dual independent reviewers, and no consensus adjudication were involved; the entire ' +
      'retrieval, extraction, and synthesis workflow was executed programmatically and is described here ' +
      'exactly as it operated.',
    `${sourcesSentence} The pipeline can search only a fixed allowlist of public sources — PubMed/MEDLINE, ` +
      'Europe PMC, OpenAlex, Semantic Scholar, ClinicalTrials.gov, openFDA, RxNorm, the GWAS Catalog and ' +
      'ClinVar — and the records above came from those; Embase, Scopus, Cochrane CENTRAL, Ovid, and Web ' +
      'of Science are not among them and were not searched, which is a coverage limitation. The pipeline did not construct a fixed Boolean search string, restrict ' +
      'results by a specific search date, or apply any machine-learning classifier, gradient-boosted ' +
      'screening model, labelled training set, or similarity threshold; each specialist issued concept ' +
      'key terms to the sources it owns, through free and keyless public interfaces, so the search can ' +
      'be reproduced without institutional subscriptions. The pipeline additionally issues targeted ' +
      'follow-up queries to PubMed for the primary reports of any landmark trials named by the retrieved ' +
      'reviews, so per-trial effect estimates are drawn from the trials themselves rather than only from ' +
      'pooled review figures.',
    'Records were eligible when they were biomedical items carrying a title and an abstract or ' +
      'structured metadata; no language filter was applied, so records published in other languages ' +
      `could be included. ${designSentence} Duplicate records were ` +
      'removed by record identifier (DOI or PMID) and then by normalised title and publication year, so ' +
      'the same study retrieved from more than one source was counted once, and retained records were ' +
      'ranked by how many distinct question concepts each one addressed, so multi-concept records led ' +
      'and single-concept noise sank. The full identification, de-duplication, and citation flow is ' +
      'shown in the study-selection figure, and a study sample size is never reused as a record count.',
    'Each structured evidence item captured its study design, population, exposure or intervention, ' +
      'comparator, reported outcomes, and any effect estimates — hazard ratios, odds ratios, risk ' +
      'ratios, mean differences, confidence intervals, and p-values — transcribed exactly as reported in ' +
      `the source text. ${outcomesSentence} A claim ledger then mapped every extracted finding to its ` +
      'source marker and graded its evidence strength on a fixed scale: strong for randomised trials, ' +
      'systematic reviews, and meta-analyses; moderate for cohort and registry studies; weak for ' +
      'cross-sectional and single indexed records; and context for regulatory or terminology sources. ' +
      'The manuscript was compiled only from approved ledger entries, and any statistic attributed to a ' +
      'source that does not report it was removed while the surrounding claim was kept in words.',
    `Synthesis was narrative and organised by evidence strength. ${synthesisSentence} No formal ` +
      'risk-of-bias instrument (such as the Cochrane risk-of-bias tool) and no GRADE certainty ' +
      'assessment were applied. Because retrieval operated on titles, abstracts, and structured metadata ' +
      'rather than full texts, the extracted effect estimates may differ from the final published ' +
      'analyses, and this is acknowledged as a limitation of the approach.',
  ];
  if (evidenceGap && evidenceGap.trim()) paragraphs.push(evidenceGap.trim());
  return paragraphs;
}

