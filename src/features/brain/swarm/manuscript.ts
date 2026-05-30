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
      'Open with the global burden and epidemiology of the condition — prevalence, incidence, mortality, morbidity, and economic or public-health impact — citing all statistics from the retrieved records. Establish the clinical significance of the problem and why it demands investigation. Narrate the existing evidence landscape: what is known, what remains contested, and what gaps persist in the literature. Explain the rationale for the specific study design and how it addresses the identified gap. Develop the conceptual framework or theoretical basis for the relationships under investigation. Define the target population and the specific clinical or research context. Close with the explicit objectives of this manuscript and a brief outline of the sections that follow. Develop every point fully — do not write brief statements; each paragraph should elaborate, explain, and provide context.',
    targetWords: '800–1100 words across 6–8 substantial paragraphs',
    minWords: 700,
  },
  {
    heading: 'Methods',
    instruction:
      'Describe the automated multi-source evidence assembly: databases queried (PubMed, Europe PMC, OpenAlex, ClinicalTrials.gov, OpenFDA, RxNorm), the specialist agents used, and the search strategy including keywords and boolean logic. State the date of search and any language or date restrictions. Specify eligibility criteria: study designs included and excluded, populations, exposures or interventions, and outcome definitions. Explain the de-duplication and relevance-ranking process. For manuscripts that include an original uploaded dataset, describe its provenance — filename, row count, variable types — and the statistical analysis pipeline applied, including descriptive and inferential methods. Explain how evidence was synthesised: narrative synthesis with evidence-strength classification (strong = RCT/systematic review, moderate = cohort/registry, weak = cross-sectional/case report, context = regulatory/drug-terminology). State explicitly that this is an automated search and extraction, not a formal hand-curated PRISMA-compliant systematic review.',
    targetWords: '600–800 words across 4–6 paragraphs',
    minWords: 500,
  },
  {
    heading: 'Evidence Base and Search Yield',
    instruction:
      'Open with the total number of records retrieved from each database, specifying the primary contributors to the evidence base. Describe the temporal spread of evidence — the earliest and most recent records, decade distribution — and what that implies about the maturity of the field. Characterise the study design mix: randomised trials, cohort studies, cross-sectional surveys, systematic reviews, case-control studies, and registry analyses, with counts where derivable. Identify the highest-quality, most directly relevant studies and describe each one — its design, population, primary question, and why it is centrally relevant — in a full prose paragraph per study or group. Note the geographic distribution of evidence where apparent. Comment on the evidence hierarchy with evidence-strength counts. Identify any obvious gaps in evidence coverage — populations understudied, comparators missing, outcomes not reported. Cite every factual claim.',
    targetWords: '650–900 words across 5–7 paragraphs',
    minWords: 550,
  },
  {
    heading: 'Mechanistic and Pharmacologic Evidence',
    instruction:
      'Explain the underlying biological and mechanistic evidence in depth. For pharmacologic questions, separate pharmacokinetic considerations (absorption, distribution, metabolism, excretion, enzyme and transporter involvement, drug-drug interaction potential) from pharmacodynamic mechanisms (receptor binding, downstream pathways, dose-response relationships). Discuss the biological plausibility of the observed or hypothesized relationships and how the mechanism translates into clinical outcomes. Address inter-individual variability sources: genetic polymorphisms, renal or hepatic function, age-related changes, comorbidities, and polypharmacy. For non-pharmacologic topics, explain the physiological pathways, cellular mechanisms, or epidemiological exposure-outcome mechanisms relevant to the question. Where the evidence base contains contradictory mechanistic findings, address them explicitly and explain possible sources of discordance. Develop each mechanistic point across multiple sentences — do not write brief bullet-equivalent clauses. Cite all mechanistic claims.',
    targetWords: '800–1050 words across 6–8 paragraphs',
    minWords: 680,
  },
  {
    heading: 'Clinical Evidence and Safety Outcomes',
    instruction:
      'Present the clinical evidence systematically, beginning with the strongest study designs (meta-analyses, RCTs) and progressing through cohort, cross-sectional, and case-series evidence. For each major study or group of studies, state: the population studied, the exposure or intervention, the comparator, the primary outcome, the magnitude and direction of the effect (including effect sizes, confidence intervals, and p-values exactly as extracted from retrieved text), and the internal validity concerns. Distinguish direct evidence from the question population from indirect or extrapolated evidence. Synthesise patterns across studies — do the findings converge or diverge, and why? Address safety outcomes explicitly: adverse events, serious harms, contraindications, dose-effect relationships, and signals from pharmacovigilance records. If retrieved records contain contradictory findings, explain the possible sources of heterogeneity — population differences, dose variation, follow-up length, outcome definition. Address subgroup differences where evidence supports this — sex, age, comorbidity burden. Conclude with an overall narrative assessment of the clinical evidence strength for the primary and secondary questions. Cite every factual claim.',
    targetWords: '900–1200 words across 7–10 paragraphs',
    minWords: 750,
  },
  {
    heading: 'Trial and Registry Evidence',
    instruction:
      'Summarise registered clinical trials and registry studies in prose — no markdown tables. Group entries by trial phase, intervention type, target population, or clinical indication. For each relevant trial or registry dataset, describe in complete sentences: the registered or reported population, primary and secondary endpoints, intervention and comparator arms, sample size and recruitment status, and the NCT number or registry identifier where available. Identify trials that are ongoing and will deliver pivotal evidence, trials completed but unpublished, and trials terminated early — and for each explain the clinical significance. Where registry datasets inform prevalence, utilisation patterns, or safety signals, describe those findings with the same precision. Highlight trials whose results, when available, will most change clinical practice. If the trial landscape is sparse, indirect, or mismatched to the primary question, explain that explicitly and say what is missing. Cite all trial information from retrieved records only.',
    targetWords: '620–860 words across 5–7 paragraphs',
    minWords: 520,
  },
  {
    heading: 'Discussion',
    instruction:
      'Begin by restating the principal findings of this evidence review in two to three sentences. Then interpret each major finding in the context of biological plausibility and prior literature — do not just list findings but explain what they mean and why they matter. Discuss the consistency of findings across studies: where evidence converges, explain why and how strongly; where evidence diverges, explore the sources of heterogeneity — population differences, methodological variation, confounding, time-period effects. Address the magnitude and clinical significance of observed effects — distinguish statistical significance from clinical relevance and patient-meaningful outcomes. Compare the findings with current clinical guidelines and standard-of-care practice: do the retrieved data support, challenge, or refine existing recommendations? Discuss the implications for clinical practice in different patient populations and settings, naming specific patient groups most affected and the trade-offs involved. Identify the remaining unanswered questions and propose specific future research directions — what study design, population, outcome measure, and follow-up duration would best fill each gap. Discuss global applicability and any population-specific or healthcare-system-specific considerations. Close with a measured interpretive synthesis: what can confidently be concluded from the assembled evidence, and what cannot. Develop every argument across multiple sentences per point — this section must be deeply analytical.',
    targetWords: '1000–1350 words across 7–10 paragraphs',
    minWords: 850,
  },
  {
    heading: 'Limitations',
    instruction:
      'State clearly that this is an automated evidence review, not a hand-curated systematic review with formal PRISMA methodology, and explain what this means for the reliability of the conclusions. Acknowledge that retrieved snippets and abstracts — not full texts — formed the primary evidence base, and that effect estimates and statistics may differ from full primary-text analyses. Discuss database coverage gaps: non-English literature, conference abstracts, grey literature, preprints, and unpublished studies not indexed in the queried databases. Address the absence of formal risk-of-bias appraisal (Cochrane RoB, GRADE) and what this means for interpreting the evidence-strength classification. If the topic has sparse direct evidence, state how much of the synthesis relies on indirect, extrapolated, or context-only records. Note any heterogeneity among retrieved studies in design, population, outcome definition, and follow-up duration that limits synthesis. Discuss limitations specific to the study design or the clinical context — for cross-sectional studies: recall bias, selection bias, inability to establish temporality; for drug-interaction topics: limited real-world data; for registry studies: confounding by indication. Develop each limitation with enough explanation that a reader can judge its severity.',
    targetWords: '400–580 words across 3–5 paragraphs',
    minWords: 340,
  },
  {
    heading: 'Conclusion',
    instruction:
      'Restate the core finding of this evidence review in two to three focused sentences — without over-claiming certainty not supported by the retrieved evidence. Translate the evidence into a concrete practical take-home message for clinicians, researchers, or policy-makers: what should change in practice, what should be monitored, or what decision is now better-informed. Identify the highest-priority research gap and state specifically what study design, population, intervention, and outcome would best fill it. Note what additional evidence is needed before the conclusions can be strengthened beyond the current level of certainty. Close with a sentence on the overall reliability and applicability of the current evidence base and the contribution of this review.',
    targetWords: '350–500 words across 3–4 paragraphs',
    minWords: 280,
  },
  {
    heading: 'Declarations',
    instruction:
      'Write one short paragraph: this manuscript is an automated evidence-review draft generated from public biomedical databases; no specific funding or conflicts of interest apply; it is intended for expert review and is not medical advice.',
    targetWords: '100–180 words in one paragraph',
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

// Imperative system-prompt sentences that never legitimately appear in a
// manuscript. Matched anywhere in a paragraph (not just at the start) so a
// prompt fragment that leaks mid-paragraph is still caught.
const PROMPT_LEAK_PHRASES_ANYWHERE = [
  'you are a biomedical research writer',
  'write only polished academic prose',
  'use only the retrieved records',
  'do not write a references or bibliography section',
  'do not invent p-values',
  'do not invent a statistic',
];

// Label-like markers that can begin a leaked prompt block but could also open
// a legitimate sentence — matched only at the start of a block to avoid false
// positives. ("Allowed use:" was removed: it is ordinary drug-label / clinical
// prose and was flagging valid manuscript text.)
const PROMPT_LEAK_PHRASES_BLOCK_START = [
  'computed inferential statistics:',
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
  if (PROMPT_LEAK_PHRASES_ANYWHERE.some((phrase) => lower.includes(phrase))) return true;
  return PROMPT_LEAK_PHRASES_BLOCK_START.some((phrase) => lower.startsWith(phrase));
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
