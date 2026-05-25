// The structured manuscript. The app owns this shape; the model only fills
// prose into it, section by section. Because the structure never depends on
// the model emitting valid JSON, the pipeline works even with small models.

import type { PublicationArtifact } from './publicationTypes';

export interface ManuscriptAbstract {
  background: string;
  objective: string;
  methods: string;
  results: string;
  conclusions: string;
}

export interface ManuscriptSection {
  heading: string;
  body: string[]; // paragraphs
}

export interface Manuscript {
  title: string;
  abstract: ManuscriptAbstract;
  keywords: string[];
  sections: ManuscriptSection[];
  // Strict renderer-owned publication package: canonical references,
  // evidence-review figures, statistics safeguards, and validation state.
  publication?: PublicationArtifact;
}

export interface SectionSpec {
  heading: string;
  instruction: string;
  targetWords: string;
  minWords: number;
}

// The fixed section list the app drafts in order. One focused model call
// fills each. Evidence-review structure — no original-trial/IRB sections.
export const SECTION_PLAN: SectionSpec[] = [
  {
    heading: 'Introduction',
    instruction:
      'Establish the clinical problem, its scope and importance, what is already known, and the aim of this evidence review.',
    targetWords: '500-750 words across 4-6 substantial paragraphs',
    minWords: 420,
  },
  {
    heading: 'Methods',
    instruction:
      'Describe how the evidence was assembled: an automated multi-source search across biomedical databases (PubMed, Europe PMC, OpenAlex, ClinicalTrials.gov, OpenFDA), the kinds of records retrieved, and how findings were selected and synthesised. Be transparent that this is an automated search, not a hand-curated systematic review.',
    targetWords: '450-650 words across 3-5 paragraphs',
    minWords: 360,
  },
  {
    heading: 'Evidence Base and Search Yield',
    instruction:
      'Describe the retrieved evidence base, source mix, record types, date spread where available, and the highest-value records for the research question. Cite every factual claim with its [S#] source marker.',
    targetWords: '500-750 words across 4-6 paragraphs',
    minWords: 420,
  },
  {
    heading: 'Mechanistic and Pharmacologic Evidence',
    instruction:
      'Explain the mechanistic and pharmacologic evidence relevant to the question. For drug-interaction topics, separate pharmacokinetic mechanisms, pharmacodynamic mechanisms, transporter/enzyme considerations, and biological plausibility. Cite every factual claim with its [S#] source marker.',
    targetWords: '650-900 words across 5-7 paragraphs',
    minWords: 540,
  },
  {
    heading: 'Clinical Evidence and Safety Outcomes',
    instruction:
      'Synthesize the clinical evidence and safety outcomes. Distinguish direct evidence from indirect evidence, registry signals from trial results, and outcome evidence from mechanistic inference. Cite every factual claim with its [S#] source marker.',
    targetWords: '700-950 words across 5-8 paragraphs',
    minWords: 580,
  },
  {
    heading: 'Trial and Registry Evidence',
    instruction:
      'Summarize clinical-trial and registry evidence without using markdown tables. Write prose grouped by trial purpose, population, intervention/exposure, and relevance to the research question. If evidence is indirect or incomplete, say so explicitly. Cite every factual claim with its [S#] source marker.',
    targetWords: '550-800 words across 4-6 paragraphs',
    minWords: 450,
  },
  {
    heading: 'Discussion',
    instruction:
      'Interpret the evidence in depth: mechanisms, the consistency and strength of the findings, conflicting or weak results, and the clinical and research implications.',
    targetWords: '800-1100 words across 6-9 paragraphs',
    minWords: 680,
  },
  {
    heading: 'Limitations',
    instruction:
      'State the limitations of this automated evidence review honestly — search coverage, reliance on abstracts and snippets, absence of formal risk-of-bias appraisal, and any gaps in the retrieved evidence.',
    targetWords: '350-550 words across 3-5 paragraphs',
    minWords: 280,
  },
  {
    heading: 'Conclusion',
    instruction:
      'Summarise the key takeaways and what further research is needed. Keep it to one or two focused paragraphs.',
    targetWords: '250-400 words across 2-3 paragraphs',
    minWords: 200,
  },
  {
    heading: 'Declarations',
    instruction:
      'Write one short paragraph: this manuscript is an automated evidence-review draft generated from public biomedical databases; no specific funding or conflicts of interest apply; it is intended for expert review and is not medical advice.',
    targetWords: '100-180 words in one paragraph',
    minWords: 80,
  },
];

function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const PROMPT_LEAK_BLOCK_START =
  /^(manuscript topic|section to (?:write now|repair)|required section intent|required minimum|target length|retrieved records|specialist findings|uploaded dataset summary|sections already drafted|other drafted sections|current draft|hard rules|formatting rules|write the .* section now|rewrite the complete .* section)\b/i;

const PROMPT_LEAK_PHRASES = [
  'you are a biomedical research writer',
  'write only polished academic prose',
  'use only the retrieved records',
  'do not write a references or bibliography section',
  'do not invent p-values',
  'do not invent a statistic',
  'allowed use:',
  'computed inferential statistics',
  'computed descriptive statistics:',
];

function isPromptLeakBlock(block: string): boolean {
  const normalized = block.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();
  const firstLine = block.split('\n').find((line) => line.trim())?.trim() ?? '';
  if (PROMPT_LEAK_BLOCK_START.test(firstLine)) return true;
  if (
    /\bmanuscript topic:\b/i.test(normalized) &&
    /\b(retrieved records|specialist findings|section to write now):\b/i.test(normalized)
  ) {
    return true;
  }
  return PROMPT_LEAK_PHRASES.some((phrase) => lower.startsWith(phrase));
}

export function stripPromptLeakage(text: string): string {
  const blocks = removeMarkdownTables(text)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.filter((block) => !isPromptLeakBlock(block)).join('\n\n');
}

export function containsPromptLeakage(text: string): boolean {
  return paragraphs(text).some(isPromptLeakBlock);
}

function isTableSeparator(line: string): boolean {
  return /^[\s|:\-]+$/.test(line) && line.includes('-');
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function tableRowsToParagraphs(rows: string[]): string[] {
  const parsed = rows.filter((line) => !isTableSeparator(line)).map(tableCells).filter((cells) => cells.length > 1);
  if (parsed.length === 0) return [];
  const hasHeader = parsed.length > 1;
  const header = parsed[0]!;
  const dataRows = hasHeader ? parsed.slice(1) : parsed;
  return dataRows.map((cells) => {
    if (hasHeader && header.length === cells.length) {
      return cells
        .map((cell, index) => `${header[index]}: ${cell}`)
        .join('; ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return cells.join('; ').replace(/\s+/g, ' ').trim();
  });
}

export function removeMarkdownTables(text: string): string {
  const output: string[] = [];
  let table: string[] = [];
  const flushTable = () => {
    if (table.length === 0) return;
    output.push(...tableRowsToParagraphs(table), '');
    table = [];
  };

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    // Strip standalone markdown horizontal rules (---, ***, ___, or longer variants)
    // and lines that are purely dashes/underscores (often output as section dividers)
    if (/^[-*_]{3,}\s*$/.test(line)) {
      flushTable();
      continue;
    }
    const isTableRow = line.includes('|') && tableCells(line).length > 1;
    if (isTableRow || (table.length > 0 && isTableSeparator(line))) {
      table.push(line);
      continue;
    }
    flushTable();
    output.push(raw);
  }
  flushTable();
  return output
    .join('\n')
    .replace(/[ \t]*\|[ \t]*/g, '; ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+([;,.])/g, '$1');
}

// Split a model's section reply into clean paragraphs, dropping any heading
// line the model may have echoed back.
export function sectionBodyFromReply(heading: string, reply: string): string[] {
  const cleaned = stripPromptLeakage(reply)
    .split('\n')
    .filter((line) => {
      const bare = line.replace(/^#+\s*/, '').replace(/[*:]/g, '').trim().toLowerCase();
      return bare !== heading.toLowerCase();
    })
    .join('\n');
  const result = paragraphs(cleaned);
  return result.length > 0 ? result : ['This section could not be drafted from the retrieved evidence.'];
}

const EMPTY_ABSTRACT: ManuscriptAbstract = {
  background: '',
  objective: '',
  methods: '',
  results: '',
  conclusions: '',
};

// Lenient parse of a "Background: … Objective: …" structured-abstract reply.
// Anything unparseable falls back to the whole reply as Background so the
// abstract is never empty.
export function parseAbstract(reply: string): ManuscriptAbstract {
  const cleanedReply = stripPromptLeakage(reply);
  const fields: (keyof ManuscriptAbstract)[] = [
    'background',
    'objective',
    'methods',
    'results',
    'conclusions',
  ];
  const abstract: ManuscriptAbstract = { ...EMPTY_ABSTRACT };
  const labelRx = /\b(background|objective[s]?|methods?|results?|conclusion[s]?)\b\s*[:\-—]\s*/gi;
  const matches = [...cleanedReply.matchAll(labelRx)];
  if (matches.length === 0) {
    abstract.background = cleanedReply.replace(/\s+/g, ' ').trim();
    return abstract;
  }
  matches.forEach((match, index) => {
    const key = match[1]!.toLowerCase().replace(/s$/, '') as string;
    const field = fields.find((f) => f.startsWith(key.slice(0, 6))) ?? 'background';
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1]!.index! : cleanedReply.length;
    abstract[field] = cleanedReply.slice(start, end).replace(/\s+/g, ' ').trim();
  });
  return abstract;
}

// Readable plain-text rendering for the chat bubble.
export function manuscriptToReadableText(manuscript: Manuscript): string {
  const lines: string[] = [manuscript.title, ''];
  lines.push('ABSTRACT');
  const a = manuscript.abstract;
  if (a.background) lines.push(`Background: ${a.background}`);
  if (a.objective) lines.push(`Objective: ${a.objective}`);
  if (a.methods) lines.push(`Methods: ${a.methods}`);
  if (a.results) lines.push(`Results: ${a.results}`);
  if (a.conclusions) lines.push(`Conclusions: ${a.conclusions}`);
  if (manuscript.keywords.length > 0) {
    lines.push('', `Keywords: ${manuscript.keywords.join(', ')}`);
  }
  for (const section of manuscript.sections) {
    lines.push('', section.heading.toUpperCase(), ...flattenBody(section.body));
  }
  return lines.join('\n');
}

function flattenBody(body: string[]): string[] {
  const out: string[] = [];
  body.forEach((paragraph, index) => {
    if (index > 0) out.push('');
    out.push(paragraph);
  });
  return out;
}
