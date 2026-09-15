// Deriving the paper's title and keywords from what the user actually asked.
//
// The hard part here is separating the SUBJECT from the REQUEST. A prompt reads
// "make a full publication-ready systematic review on whether GLP-1 receptor
// agonists reduce major adverse cardiovascular events" — and only the second
// half of that is the paper's topic. Keying the title or the keywords off the
// raw prompt produced titles containing "make a full" and keyword lists
// containing "publication", "ready" and "focus".
//
// So both stopword sets are load-bearing rather than cosmetic. One strips the
// deliverable and instruction words, the other strips comparison and temporal
// framing ("differ", "decade", "recent") that describes how the question is
// asked rather than what it is about. An explicit user-supplied title always
// wins outright over any of it.

import { normalizeMedicalSpelling } from './queryNormalize';

// Words that describe the REQUEST or the deliverable ("make a full research
// paper about ...") rather than the subject. Stripped from the fallback title
// and from keyword extraction so neither echoes the user's instruction verbatim
// (the source of titles like "Full reaserch paper about ..." and keywords like
// "full, reaserch"). Includes common misspellings of "research".
const META_INSTRUCTION_WORDS = new Set([
  'make', 'write', 'draft', 'create', 'generate', 'produce', 'compose', 'prepare', 'give', 'need',
  'want', 'please', 'full', 'complete', 'comprehensive', 'detailed', 'thorough', 'professional',
  'publishable', 'proper', 'research', 'reaserch', 'reasearch', 'reserch', 'paper', 'manuscript',
  'article', 'report', 'document', 'about', 'regarding', 'concerning', 'statistics', 'statistical',
  'stats', 'numbers', 'numeric', 'data',
  // publication-ready / ready / assessing leaked into the title and keywords
  // because the leading-meta strip stopped at the first unrecognised word.
  'publication', 'publicationready', 'ready', 'assessing', 'assess', 'assessment', 'evaluating',
  'evaluate', 'evaluation', 'analysing', 'analyzing', 'analyse', 'analyze', 'investigating',
  'investigate', 'examining', 'examine', 'summarize', 'summarise', 'summary', 'overview', 'building',
  'build', 'using', 'reuse', 'leverage', 'incorporate',
]);

const STRUCTURAL_WORDS = new Set(['a', 'an', 'the', 'me', 'on', 'of', 'for', 'to', 'with', 'in']);

// Strip leading request/deliverable words ("make a full research paper about")
// token by token — robust to word order and misspellings, unlike a fixed regex.
function stripLeadingMeta(text: string): string {
  const tokens = text.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const w = tokens[i]!.toLowerCase().replace(/[^a-z]/g, '');
    if (META_INSTRUCTION_WORDS.has(w) || STRUCTURAL_WORDS.has(w)) i += 1;
    else break;
  }
  return tokens.slice(i).join(' ');
}

// Strip a trailing "with statistics / and stats / including numeric data" clause
// — an instruction about presentation, not part of the subject.
function stripTrailingMeta(text: string): string {
  return text
    .replace(/[\s,]+(with|and|including|plus|featuring)\s+(statistics|statistical analysis|stats|numbers|numeric data|data|figures)\s*$/i, '')
    .trim();
}

// Common typos corrected before a token reaches a title or keyword list.
const TYPO_FIXES: Record<string, string> = {
  reaserch: 'research',
  reasearch: 'research',
  reserch: 'research',
  mecanism: 'mechanism',
  mechanim: 'mechanism',
  pharmacolgy: 'pharmacology',
  warafin: 'warfarin',
  digoxine: 'digoxin',
  cardiovascual: 'cardiovascular',
  cardiovasclar: 'cardiovascular',
  cardivascular: 'cardiovascular',
  diabetis: 'diabetes',
  hypertention: 'hypertension',
};

function fixTypos(text: string): string {
  return text.replace(/[A-Za-z]+/g, (w) => TYPO_FIXES[w.toLowerCase()] ?? w);
}

const EXPLICIT_TITLE_RX = /\b(?:titled|entitled|title)\s*:?\s*["“”']([^"“”']{8,200})["“”']/i;

export function extractExplicitTitle(question: string): string | undefined {
  const match = question.match(EXPLICIT_TITLE_RX);
  if (!match) return undefined;
  // Strip a trailing sentence period that sat inside the quotes — titles do not
  // end in a full stop — but keep meaningful punctuation like a colon.
  const title = (match[1] ?? '').replace(/\s+/g, ' ').replace(/\s*\.\s*$/, '').trim();
  return title.length >= 8 ? title : undefined;
}

export function titleTopic(question: string): string {
  // An explicit user-supplied title wins outright.
  const explicit = extractExplicitTitle(question);
  if (explicit) return fixTypos(explicit);
  // A title is a single subject phrase, never the formatting instructions. Take
  // the first sentence so a trailing "Use full IMRaD structure… Compute the
  // statistics… flag any evidence gaps honestly." tail is dropped, then strip the
  // leading request words and any trailing presentation clause.
  const firstSentence = question.split(/(?<=[.!?])\s+/)[0] ?? question;
  const subject = stripTrailingMeta(stripLeadingMeta(firstSentence)).replace(/\s+/g, ' ').trim();
  if (subject.split(/\s+/).filter(Boolean).length >= 3) return fixTypos(subject);
  // The first sentence was too thin (e.g. an abbreviation period) — fall back to
  // stripping the whole question.
  const full = stripTrailingMeta(stripLeadingMeta(question)).replace(/\s+/g, ' ').trim();
  return fixTypos(full || question.trim());
}

// Comparison / temporal / question words that describe the QUESTION, not the
// medical subject, so they must never become keywords ("how does the effect
// DIFFER … over the last DECADE" must not yield "differ"/"decade" as keywords).
const NON_TOPIC_KEYWORDS = new Set([
  'differ', 'differs', 'differed', 'difference', 'differences', 'differential',
  'compare', 'compared', 'comparing', 'comparison', 'versus', 'change', 'changed', 'changes', 'changing',
  'decade', 'decades', 'recent', 'recently', 'trend', 'trends', 'last', 'over', 'past', 'consensus',
  // Request/format words that leaked from "publishable-quality research paper
  // titled …" into the keyword list.
  'publishable', 'publishable-quality', 'quality', 'titled', 'across', 'spectrum', 'current',
  // Action / instruction verbs that describe the REQUEST, not the subject
  // ("comparing … for SLOWING … , REPORT … , WEIGH the risk … , DISCUSS …").
  'slowing', 'weigh', 'weighing', 'weighed', 'reporting', 'discuss', 'discussing', 'discussed',
  'including', 'include', 'includes', 'measuring', 'measured', 'examining', 'exploring',
  // Statistical-reporting descriptors ("report the EFFECT SIZES, CONFIDENCE
  // INTERVALS, and P-VALUES") — they name what to report, not the medical topic,
  // and produced junk keywords like "effect sizes" and "p-values weigh".
  'effect', 'effects', 'size', 'sizes', 'confidence', 'interval', 'intervals', 'p-value', 'p-values',
  'pvalue', 'pvalues', 'significance', 'estimate', 'estimates', 'value', 'values',
  // Structural / study-type / label words that describe the DELIVERABLE or the
  // review TYPE, not the medical subject. "title" leaked from an explicit
  // "Title:" label into the keyword line; "systematic"/"meta-analysis" name the
  // review type; "impact" is a vague connective ("impact of X on Y"); "adults"
  // is a generic population qualifier; "type" is a tokenization artifact left
  // behind when "type 2 diabetes" splits on the digit.
  'title', 'systematic', 'meta-analysis', 'metaanalysis', 'meta', 'impact', 'adults', 'adult', 'type',
  // Framing words that lead a review question ("… on WHETHER X REDUCES Y", "an
  // EVIDENCE review of …") but are not the medical subject.
  'whether', 'evidence', 'reduce', 'reduces', 'reduced', 'reducing', 'association', 'associations',
]);

// Connectors, articles, and request words that separate one keyword PHRASE from
// the next. Splitting the title at these keeps multi-word medical terms intact
// ("direct oral anticoagulants", "atrial fibrillation") instead of shattering
// them into single words, which is what made the keyword line read
// "direct, oral, anticoagulants, warfarin, …".
const KEYWORD_PHRASE_STOP = new Set([
  'and', 'or', 'of', 'the', 'a', 'an', 'for', 'in', 'on', 'with', 'to', 'by', 'at', 'from', 'into',
  'versus', 'vs', 'over', 'under', 'between', 'among', 'than', 'as', 'is', 'are', 'be', 'their', 'its',
  'this', 'that', 'these', 'those', 'about', 'regarding', 'concerning',
  // request / deliverable words
  'write', 'draft', 'create', 'generate', 'produce', 'make', 'full', 'complete', 'comprehensive',
  'detailed', 'thorough', 'professional', 'research', 'paper', 'manuscript', 'article', 'report',
  'review', 'summary', 'patient', 'patients', 'publication', 'publication-ready', 'ready',
  'assess', 'assessing', 'evaluate', 'evaluating', 'examine', 'explore', 'investigate', 'determine',
  'using', 'use', 'uses', 'used', 'statistics', 'statistical', 'stats', 'numeric', 'numbers', 'data',
  'analysis', 'analyse', 'analyze',
]);

// Keywords are drawn from the SUBJECT (instruction words stripped), with typos
// corrected and instruction/deliverable words excluded — so a request like
// "make a full reaserch paper about ..." yields the actual topic terms, never
// "full" or "reaserch".
export function keywordsFrom(question: string): string[] {
  // Split the subject text into PHRASES at connector/request words and keep each
  // run of consecutive content words as one keyword, so multi-word medical terms
  // survive. When the user gave an explicit title, key from the TITLE (the real
  // subject), not the surrounding instruction. Normalise spelling first.
  const source = extractExplicitTitle(question) ?? question;
  const tokens = normalizeMedicalSpelling(source)
    .toLowerCase()
    // Drop the possessive so "Alzheimer's disease" stays one phrase instead of
    // shattering into "alzheimer" + a stray "s" + "disease".
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const phrases: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > 0) {
      const phrase = run.slice(0, 4).join(' ').trim(); // cap a phrase at 4 words
      if (phrase.length >= 3) phrases.push(phrase);
    }
    run = [];
  };
  for (const token of tokens) {
    if (token.length < 3 || /^\d+$/.test(token) || KEYWORD_PHRASE_STOP.has(token) || NON_TOPIC_KEYWORDS.has(token)) {
      flush();
    } else {
      run.push(token);
    }
  }
  flush();

  return [...new Set(phrases)].slice(0, 8);
}

