// The structured manuscript. The app owns this shape; the model only fills
// prose into it, section by section. Because the structure never depends on
// the model emitting valid JSON, the pipeline works even with small models.

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
}

export interface SectionSpec {
  heading: string;
  instruction: string;
}

// The fixed section list the app drafts in order. One focused model call
// fills each. Evidence-review structure — no original-trial/IRB sections.
export const SECTION_PLAN: SectionSpec[] = [
  {
    heading: 'Introduction',
    instruction:
      'Establish the clinical problem, its scope and importance, what is already known, and the aim of this evidence review. Write 2-4 substantial paragraphs.',
  },
  {
    heading: 'Methods',
    instruction:
      'Describe how the evidence was assembled: an automated multi-source search across biomedical databases (PubMed, Europe PMC, OpenAlex, ClinicalTrials.gov, OpenFDA), the kinds of records retrieved, and how findings were selected and synthesised. Be transparent that this is an automated search, not a hand-curated systematic review.',
  },
  {
    heading: 'Results',
    instruction:
      'Present the major findings grouped by theme. Cite every factual claim with its [S#] marker. Write several substantial paragraphs covering the strongest evidence.',
  },
  {
    heading: 'Discussion',
    instruction:
      'Interpret the evidence in depth: mechanisms, the consistency and strength of the findings, conflicting or weak results, and the clinical and research implications.',
  },
  {
    heading: 'Limitations',
    instruction:
      'State the limitations of this automated evidence review honestly — search coverage, reliance on abstracts and snippets, absence of formal risk-of-bias appraisal, and any gaps in the retrieved evidence.',
  },
  {
    heading: 'Conclusion',
    instruction:
      'Summarise the key takeaways and what further research is needed. Keep it to one or two focused paragraphs.',
  },
  {
    heading: 'Declarations',
    instruction:
      'Write one short paragraph: this manuscript is an automated evidence-review draft generated from public biomedical databases; no specific funding or conflicts of interest apply; it is intended for expert review and is not medical advice.',
  },
];

function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Split a model's section reply into clean paragraphs, dropping any heading
// line the model may have echoed back.
export function sectionBodyFromReply(heading: string, reply: string): string[] {
  const cleaned = reply
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
  const fields: (keyof ManuscriptAbstract)[] = [
    'background',
    'objective',
    'methods',
    'results',
    'conclusions',
  ];
  const abstract: ManuscriptAbstract = { ...EMPTY_ABSTRACT };
  const labelRx = /\b(background|objective[s]?|methods?|results?|conclusion[s]?)\b\s*[:\-—]\s*/gi;
  const matches = [...reply.matchAll(labelRx)];
  if (matches.length === 0) {
    abstract.background = reply.replace(/\s+/g, ' ').trim();
    return abstract;
  }
  matches.forEach((match, index) => {
    const key = match[1]!.toLowerCase().replace(/s$/, '') as string;
    const field = fields.find((f) => f.startsWith(key.slice(0, 6))) ?? 'background';
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1]!.index! : reply.length;
    abstract[field] = reply.slice(start, end).replace(/\s+/g, ' ').trim();
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
