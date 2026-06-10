// draftManuscript — builds a Manuscript section by section. The app owns the
// section list; each model call writes only one section's prose. This is what
// makes the pipeline reliable across models: no model ever has to emit a large
// structured document, just a few paragraphs at a time.

import { completeWithModelChain } from '@core/llm/ProviderRegistry';
import type { EvidenceItem } from '@platform/index';
import { showToast } from '@core/store/toastStore';
import {
  containsPromptLeakage,
  parseAbstract,
  sectionBodyFromReply,
  SECTION_PLAN,
  type SectionSpec,
  type Manuscript,
  type ManuscriptSection,
} from './manuscript';
import { formatEvidenceList } from './evidenceFormat';
import { buildPublicationArtifact } from './publication';
import { datasetSummaryForPrompt } from './statistics';
import { keywordsFrom } from './paperPipeline';
import type { ManuscriptStandard, UploadedDatasetSummary } from './publicationTypes';
import type { SpecialistResult } from './types';

const MAX_EVIDENCE = 64;
const SECTION_TOKENS = 5200;
const MAX_SECTION_PASSES = 4;
const MAX_REPAIR_PASSES = 3;

const SECTION_SYSTEM = `You are a biomedical research writer drafting ONE section of a biomedical manuscript for HashCerebrum.
- Write only polished academic prose in full paragraphs for the requested section. Do not write other sections, a title, or a heading line.
- Do not use markdown tables, pipe tables, ASCII tables, bullet lists, numbered lists, or chat-style summaries. Convert comparisons into prose.
- Make the section read like a serious journal manuscript: dense, precise, source-grounded, and professionally edited.
- Use only the retrieved records and specialist findings supplied. Cite every factual claim with its internal [S#] source marker.
- If an uploaded dataset summary is supplied, you may narrate only the exact descriptive and inferential statistics already computed by the validated in-app statistics engine.
- Never invent a statistic, study finding, PMID, DOI, author, year, or title. If the evidence or dataset is thin for this section, say so plainly.
- Do not write a References or Bibliography section — references are added automatically.`;

export interface DraftManuscriptOptions {
  question: string;
  bossModel: string;
  evidence: EvidenceItem[];
  specialists: SpecialistResult[];
  standard?: ManuscriptStandard;
  dataset?: UploadedDatasetSummary | null;
  onSection?: (heading: string) => void;
}

function formatEvidence(evidence: EvidenceItem[]): string {
  return formatEvidenceList(evidence, { markerPrefix: 'S', maxItems: MAX_EVIDENCE });
}

function specialistDigest(specialists: SpecialistResult[]): string {
  const parts = specialists
    .filter((specialist) => !specialist.error && specialist.findings.trim())
    .map((specialist) => `${specialist.label}: ${specialist.findings.replace(/\s+/g, ' ').slice(0, 600)}`);
  return parts.length > 0 ? parts.join('\n\n') : '(no specialist findings were available)';
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length;
}

function bodyWordCount(body: string[]): number {
  return wordCount(body.join(' '));
}

function isDraftFailure(body: string[]): boolean {
  const text = body.join(' ').toLowerCase();
  return text.includes('could not be drafted') || text.includes('could not complete');
}

function titleTopic(question: string): string {
  // First sentence only, so a trailing instruction tail ("Use full IMRaD…") is
  // dropped, then strip the leading request clause.
  const firstSentence = question.split(/(?<=[.!?])\s+/)[0] ?? question;
  const topic = firstSentence
    .replace(
      /^\s*(make|write|draft|create|generate|produce|compose|prepare)\s+(a\s+|an\s+|the\s+)?(complete\s+|full\s+|comprehensive\s+|publication[-\s]?ready\s+)*(research\s+|scientific\s+)?(paper|manuscript|article|review|report)\s+(about|on|for|assessing|evaluating|regarding|examining)\s+/i,
      '',
    )
    .replace(/^\s*(make|write|draft|create|generate|produce)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return topic || question.trim() || 'the requested biomedical question';
}

function fallbackTitle(question: string, dataset?: UploadedDatasetSummary | null): string {
  const topic = titleTopic(question);
  return dataset ? `Original Dataset Analysis of ${topic}` : `Evidence Review of ${topic}`;
}

function titleLooksUnsafe(title: string): boolean {
  if (!title || title.length < 8 || title.length > 180) return true;
  if (containsPromptLeakage(title)) return true;
  return /\b(write|draft|generate)\s+(a\s+)?manuscript\b/i.test(title) ||
    /\b(manuscript topic|retrieved records|specialist findings|section to write)\b/i.test(title);
}

function cleanTitle(reply: string, question: string, dataset?: UploadedDatasetSummary | null): string {
  const firstLine = reply.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const candidate = firstLine
    .replace(/^#+\s*/, '')
    .replace(/^title\s*[:\-]\s*/i, '')
    .replace(/^["'#\s]+|["'\s]+$/g, '')
    .trim();
  return titleLooksUnsafe(candidate) ? fallbackTitle(question, dataset) : candidate;
}

function fmt(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'not available';
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(3).replace(/\.?0+$/, '');
}

function computedDatasetSection(dataset: UploadedDatasetSummary): ManuscriptSection {
  const body: string[] = [];
  body.push(
    `The uploaded dataset (${dataset.filename}) contained ${dataset.rows} analysable rows and ${dataset.columns.length} columns. The raw-file SHA-256 fingerprint is ${dataset.sha256}, which allows the analysis to be audited against the exact uploaded data rather than a language-model reconstruction. HashCerebrum parsed the delimited file, typed variables as numeric or categorical from observed values, and computed descriptive summaries before any manuscript prose was generated.`,
  );

  const descriptive = dataset.columnSummaries
    .slice(0, 10)
    .map((column) => {
      if (column.type === 'numeric') {
        return `${column.name}: n=${column.nonMissing}, missing=${column.missing}, mean ${fmt(column.mean)}, SD ${fmt(column.sd)}, median ${fmt(column.median)}, range ${fmt(column.min)}-${fmt(column.max)}`;
      }
      const levels = column.levels?.slice(0, 5).map((level) => `${level.value} ${level.count}`).join(', ') ?? 'no observed levels';
      return `${column.name}: n=${column.nonMissing}, missing=${column.missing}, levels ${levels}`;
    })
    .join('; ');
  body.push(
    `Descriptive statistics were computed directly in code and are summarized for the principal variables as follows: ${descriptive}. These values are deterministic outputs from the uploaded dataset and are not model-generated estimates.`,
  );

  const inferential = dataset.inferential;
  if (!inferential?.generated) {
    body.push(
      `No validated inferential analysis plan could be generated from the available columns. The manuscript may discuss the dataset descriptively, but it must not report p-values, odds ratios, hazard ratios, confidence intervals, or subgroup effects for this dataset unless a future upload supplies the variables needed for a valid analysis. ${inferential?.notes.join(' ') ?? ''}`.trim(),
    );
    return { heading: 'Dataset and Statistical Analysis', body };
  }

  body.push(
    `The validated in-app statistics engine generated an inferential analysis plan and produced the following analysis-ready results: ${inferential.analyses.map((analysis) => analysis.reportText).join(' ')}`,
  );
  if (inferential.subgroups) {
    body.push(inferential.subgroups.reportText);
  }
  if (inferential.survival) {
    body.push(inferential.survival.reportText);
  }
  if (inferential.notes.length > 0) {
    body.push(`Statistical caveats from the analysis engine were: ${inferential.notes.join(' ')}`);
  }
  return { heading: 'Dataset and Statistical Analysis', body };
}

function insertDatasetSection(sections: ManuscriptSection[], dataset?: UploadedDatasetSummary | null): ManuscriptSection[] {
  if (!dataset) return sections;
  const section = computedDatasetSection(dataset);
  if (sections.some((candidate) => candidate.heading === section.heading)) return sections;
  const methodsIndex = sections.findIndex((candidate) => candidate.heading === 'Methods');
  if (methodsIndex < 0) return [section, ...sections];
  return [
    ...sections.slice(0, methodsIndex + 1),
    section,
    ...sections.slice(methodsIndex + 1),
  ];
}

async function callModel(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const response = await completeWithModelChain(model, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.25,
    maxTokens,
  });
  return response.content.trim();
}

function repairableHeadings(
  manuscript: Manuscript,
  evidence: EvidenceItem[],
  dataset?: UploadedDatasetSummary | null,
): string[] {
  const artifact = buildPublicationArtifact(manuscript, evidence, {
    ...(dataset ? { dataset } : {}),
  });
  const headings = artifact.validation.blockers
    .filter((issue) =>
      issue.section &&
      ['section-too-short', 'section-missing-citation', 'unsupported-statistic'].includes(issue.code),
    )
    .map((issue) => issue.section!);
  return [...new Set(headings)].filter((heading) => SECTION_PLAN.some((spec) => spec.heading === heading));
}

async function repairSection(opts: {
  model: string;
  question: string;
  spec: SectionSpec;
  currentBody: string[];
  evidenceBlock: string;
  digest: string;
  datasetBlock: string;
  priorDigest: string;
}): Promise<string[]> {
  const reply = await callModel(
    opts.model,
    SECTION_SYSTEM,
    `Repair one manuscript section that failed publication validation.

Manuscript topic: ${opts.question}
Section to repair: ${opts.spec.heading}
Required section intent: ${opts.spec.instruction}
Required minimum: ${opts.spec.minWords} words. Target: ${opts.spec.targetWords}.

Current draft:
${opts.currentBody.join('\n\n')}

Retrieved records:
${opts.evidenceBlock}

Specialist findings:
${opts.digest}

Uploaded dataset summary, if supplied:
${opts.datasetBlock}

Other drafted sections for continuity:
${opts.priorDigest}

Rewrite the complete ${opts.spec.heading} section as a full replacement. Fix missing citations, unsupported statistics, thin analysis, and note-like prose. Every factual claim must use real [S#] source markers from the retrieved records. Do not invent p-values, confidence intervals, hazard ratios, or odds ratios — report only the statistics already computed in the dataset analysis block above. Do not invent trial outcomes, titles, PMIDs, DOIs, or years. Do not write headings, lists, tables, References, or Bibliography.`,
    SECTION_TOKENS,
  );
  return sectionBodyFromReply(opts.spec.heading, reply);
}

export async function draftManuscript(opts: DraftManuscriptOptions): Promise<Manuscript> {
  const { question, bossModel, evidence, specialists, dataset, standard = 'icmje_generic' } = opts;
  const evidenceBlock = formatEvidence(evidence);
  const digest = specialistDigest(specialists);
  const datasetBlock = dataset ? datasetSummaryForPrompt(dataset) : '(no uploaded dataset was supplied)';

  // Title — a focused one-line call; falls back to the question.
  let title = fallbackTitle(question, dataset);
  try {
    opts.onSection?.('Title');
    const reply = await callModel(
      bossModel,
      'You write concise, formal academic manuscript titles. Reply with the title only — no quotation marks, no extra text.',
      `Write a manuscript title for ${dataset ? 'an original-data biomedical manuscript with retrieved evidence context' : 'an evidence-review manuscript'} addressing: ${question}`,
      120,
    );
    title = cleanTitle(reply, question, dataset);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn('[manuscriptWriter] Title generation failed:', detail);
    showToast('Title generation failed — using fallback', 'error');
  }

  // Sections — one focused call each; a failed section degrades to a note.
  const sections: ManuscriptSection[] = [];
  for (const spec of SECTION_PLAN) {
    opts.onSection?.(spec.heading);
    const priorDigest =
      sections.map((section) => `${section.heading}: ${(section.body[0] ?? '').slice(0, 180)}`).join('\n') ||
      '(none yet)';
    const user = `Manuscript topic: ${question}

Section to write now: ${spec.heading}
${spec.instruction}
Target length: ${spec.targetWords}. Do not underwrite this section unless the retrieved evidence is genuinely too thin.

Retrieved records:
${evidenceBlock}

Specialist findings:
${digest}

Uploaded dataset summary, if supplied:
${datasetBlock}

Sections already drafted (for continuity — do not repeat their content):
${priorDigest}

Write the ${spec.heading} section now as final manuscript prose, not notes. If a dataset summary is supplied, narrate only the statistics it lists — both the computed descriptive statistics and any inferential statistics already computed by the validated analysis engine — using those exact numbers, and never compute or invent a statistic yourself.`;
    try {
      const reply = await callModel(bossModel, SECTION_SYSTEM, user, SECTION_TOKENS);
      let body = sectionBodyFromReply(spec.heading, reply);
      let passes = 1;
      while (bodyWordCount(body) < spec.minWords && !isDraftFailure(body) && passes < MAX_SECTION_PASSES) {
        opts.onSection?.(`${spec.heading} expansion ${passes}`);
        const expansion = await callModel(
          bossModel,
          SECTION_SYSTEM,
          `${user}

The current ${spec.heading} draft is ${bodyWordCount(body)} words, below the required minimum of ${spec.minWords} words:
${body.join('\n\n')}

Rewrite the complete ${spec.heading} section as a full replacement. Target ${spec.targetWords}, and do not stop early. Keep every factual claim tied to [S#] source markers. If the retrieved evidence is genuinely thin, still write a complete, transparent section that explains the uncertainty instead of returning notes. Do not use markdown tables or lists.`,
          SECTION_TOKENS,
        );
        body = sectionBodyFromReply(spec.heading, expansion);
        passes += 1;
      }
      sections.push({ heading: spec.heading, body });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      sections.push({ heading: spec.heading, body: [`This section could not be drafted: ${detail}`] });
    }
  }

  const sectionsWithDataset = insertDatasetSection(sections, dataset);
  sections.splice(0, sections.length, ...sectionsWithDataset);

  // Validation repair — after the first pass, regenerate only sections that
  // fail publication gates instead of throwing away the whole manuscript.
  for (let repairPass = 0; repairPass < MAX_REPAIR_PASSES; repairPass += 1) {
    const draftForValidation: Manuscript = {
      title,
      abstract: parseAbstract(''),
      keywords: keywordsFrom(question),
      sections,
    };
    const headings = repairableHeadings(draftForValidation, evidence, dataset);
    if (headings.length === 0) break;

    for (const heading of headings) {
      const index = sections.findIndex((section) => section.heading === heading);
      const spec = SECTION_PLAN.find((candidate) => candidate.heading === heading);
      if (index < 0 || !spec) continue;
      opts.onSection?.(`${heading} validation repair ${repairPass + 1}`);
      const priorDigest =
        sections
          .filter((section) => section.heading !== heading)
          .map((section) => `${section.heading}: ${(section.body[0] ?? '').slice(0, 180)}`)
          .join('\n') || '(none yet)';
      try {
        sections[index] = {
          heading,
          body: await repairSection({
            model: bossModel,
            question,
            spec,
            currentBody: sections[index]!.body,
            evidenceBlock,
            digest,
            datasetBlock,
            priorDigest,
          }),
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn('[manuscriptWriter] Section repair failed:', detail);
        showToast('Section repair failed — keeping previous draft', 'error');
      }
    }
  }

  // Abstract — drafted last, from the assembled sections.
  let abstract = parseAbstract('');
  try {
    opts.onSection?.('Abstract');
    const sectionDigest = sections
      .map((section) => `${section.heading}\n${section.body.join(' ')}`)
      .join('\n\n')
      .slice(0, 6000);
    const reply = await callModel(
      bossModel,
      'You write structured scientific abstracts for journal manuscripts. Reply with exactly five labelled fields — Background:, Objective:, Methods:, Results:, Conclusions: — each field two to four polished sentences, and nothing else.',
      `Write the structured abstract for the manuscript titled "${title}". Base it only on the drafted sections below.\n\n${sectionDigest}`,
      1100,
    );
    abstract = parseAbstract(reply);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn('[manuscriptWriter] Abstract generation failed:', detail);
    showToast('Abstract generation failed — leaving empty', 'error');
  }

  const manuscript: Manuscript = { title, abstract, keywords: keywordsFrom(question), sections };
  return {
    ...manuscript,
    publication: buildPublicationArtifact(manuscript, evidence, {
      standard,
      ...(dataset ? { dataset } : {}),
    }),
  };
}
