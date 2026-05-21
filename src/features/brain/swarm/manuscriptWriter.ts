// draftManuscript — builds a Manuscript section by section. The app owns the
// section list; each model call writes only one section's prose. This is what
// makes the pipeline reliable across models: no model ever has to emit a large
// structured document, just a few paragraphs at a time.

import { completeWithModelChain } from '@core/llm/ProviderRegistry';
import type { EvidenceItem } from '@platform/index';
import {
  parseAbstract,
  sectionBodyFromReply,
  SECTION_PLAN,
  type SectionSpec,
  type Manuscript,
  type ManuscriptSection,
} from './manuscript';
import { buildPublicationArtifact } from './publication';
import type { SpecialistResult } from './types';

const SNIPPET_CHARS = 200;
const MAX_EVIDENCE = 48;
const SECTION_TOKENS = 2600;
const MAX_SECTION_PASSES = 3;
const MAX_REPAIR_PASSES = 2;

const STOPWORDS = new Set([
  'about', 'after', 'against', 'and', 'are', 'between', 'during', 'from', 'into',
  'over', 'their', 'them', 'then', 'there', 'these', 'this', 'those', 'with',
  'within', 'what', 'which', 'while', 'review', 'research', 'paper', 'study',
]);

const SECTION_SYSTEM = `You are a biomedical research writer drafting ONE section of an evidence-review manuscript for HashCerebrum.
- Write only polished academic prose in full paragraphs for the requested section. Do not write other sections, a title, or a heading line.
- Do not use markdown tables, pipe tables, ASCII tables, bullet lists, numbered lists, or chat-style summaries. Convert comparisons into prose.
- Make the section read like a serious journal manuscript: dense, precise, source-grounded, and professionally edited.
- Use only the retrieved records and specialist findings supplied. Cite every factual claim with its [S#] marker.
- Never invent a statistic, study finding, PMID, DOI, author, year, or title. If the evidence is thin for this section, say so plainly.
- Do not write a References or Bibliography section — references are added automatically.`;

export interface DraftManuscriptOptions {
  question: string;
  bossModel: string;
  evidence: EvidenceItem[];
  specialists: SpecialistResult[];
  onSection?: (heading: string) => void;
}

function formatEvidence(evidence: EvidenceItem[]): string {
  if (evidence.length === 0) return '(no source records were retrieved)';
  return evidence
    .slice(0, MAX_EVIDENCE)
    .map((record, index) => {
      const year = record.year ? ` (${record.year})` : '';
      const id = record.identifiers?.pmid
        ? ` PMID:${record.identifiers.pmid}`
        : record.identifiers?.doi
          ? ` DOI:${record.identifiers.doi}`
          : '';
      const snippet = record.snippet
        ? ` — ${record.snippet.replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS)}`
        : '';
      return `[S${index + 1}] ${record.source.toUpperCase()}${year} ${record.title}.${id}${snippet}`;
    })
    .join('\n');
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

function keywordsFrom(question: string): string[] {
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
  return [...new Set(words)].slice(0, 6);
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

function repairableHeadings(manuscript: Manuscript, evidence: EvidenceItem[]): string[] {
  const artifact = buildPublicationArtifact(manuscript, evidence);
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

Other drafted sections for continuity:
${opts.priorDigest}

Rewrite the complete ${opts.spec.heading} section as a full replacement. Fix missing citations, unsupported statistics, thin analysis, and note-like prose. Every factual claim must use real [S#] markers from the retrieved records. Do not invent p-values, confidence intervals, hazard ratios, odds ratios, trial outcomes, titles, PMIDs, DOIs, or years. Do not write headings, lists, tables, References, or Bibliography.`,
    SECTION_TOKENS,
  );
  return sectionBodyFromReply(opts.spec.heading, reply);
}

export async function draftManuscript(opts: DraftManuscriptOptions): Promise<Manuscript> {
  const { question, bossModel, evidence, specialists } = opts;
  const evidenceBlock = formatEvidence(evidence);
  const digest = specialistDigest(specialists);

  // Title — a focused one-line call; falls back to the question.
  let title = question.trim();
  try {
    opts.onSection?.('Title');
    const reply = await callModel(
      bossModel,
      'You write concise, formal academic manuscript titles. Reply with the title only — no quotation marks, no extra text.',
      `Write a manuscript title for an evidence review addressing: ${question}`,
      120,
    );
    const firstLine = reply.split('\n').map((line) => line.trim()).find(Boolean);
    if (firstLine) title = firstLine.replace(/^["'#\s]+|["'\s]+$/g, '') || title;
  } catch {
    /* keep the question as the title */
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

Sections already drafted (for continuity — do not repeat their content):
${priorDigest}

Write the ${spec.heading} section now as final manuscript prose, not notes.`;
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

Rewrite the complete ${spec.heading} section as a full replacement. Target ${spec.targetWords}, and do not stop early. Keep every factual claim tied to [S#] citations. If the retrieved evidence is genuinely thin, still write a complete, transparent section that explains the uncertainty instead of returning notes. Do not use markdown tables or lists.`,
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

  // Validation repair — after the first pass, regenerate only sections that
  // fail publication gates instead of throwing away the whole manuscript.
  for (let repairPass = 0; repairPass < MAX_REPAIR_PASSES; repairPass += 1) {
    const draftForValidation: Manuscript = {
      title,
      abstract: parseAbstract(''),
      keywords: keywordsFrom(question),
      sections,
    };
    const headings = repairableHeadings(draftForValidation, evidence);
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
            priorDigest,
          }),
        };
      } catch {
        /* keep the previous section; final validation will block export if needed */
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
  } catch {
    /* keep the empty abstract */
  }

  const manuscript: Manuscript = { title, abstract, keywords: keywordsFrom(question), sections };
  return {
    ...manuscript,
    publication: buildPublicationArtifact(manuscript, evidence),
  };
}
