// Landmark-trial backfill.
//
// A comparative or outcomes question ("report the hazard ratios from the
// landmark trials") often retrieves mostly meta-analyses, systematic reviews,
// and guidelines. Those pool the primary trials and rarely restate each trial's
// own hazard ratio, so the draft ends up citing review-level pooled numbers and
// admits "the exact hazard ratios … are not reported in the retrieved records".
//
// This pass reads the trial names the retrieved reviews already cite (EMPA-REG
// OUTCOME, DECLARE-TIMI 58, LEADER, …) and fetches those PRIMARY trial reports,
// whose abstracts carry the per-trial effect sizes. It is deterministic (a
// regex harvester + a bounded PubMed fetch), best-effort (a failure never breaks
// a run), and additive (it only adds records — ranking drops anything off-topic).

import { tools as toolRegistry } from '@core/tools/ToolRegistry';
import type { EvidenceItem, MedicalSourceResult } from '@platform/index';
import type { SpecialistResult, SwarmCallbacks } from './types';
import { isApprovedGeneSymbol } from './genetics/geneQueryReadiness';

// ALL-CAPS tokens that are NOT trial names — drug classes, endpoints, stats,
// organisations, registries. Keeps the harvester from firing junk searches.
const NON_TRIAL_CAPS = new Set([
  'SGLT2', 'SGLT', 'GLP', 'GLP1', 'DPP', 'DPP4', 'ASCVD', 'CVD', 'CVOT', 'CVOTS', 'MACE',
  'HFPEF', 'HFREF', 'HHF', 'CKD', 'ESRD', 'ESKD', 'HBA1C', 'BMI', 'LDL', 'HDL', 'VLDL',
  'T1DM', 'T2DM', 'T2D', 'T1D', 'NYHA', 'LVEF', 'EGFR', 'UACR', 'BNP', 'NTPROBNP',
  'ADA', 'EASD', 'ESC', 'AHA', 'ACC', 'FDA', 'EMA', 'WHO', 'NICE', 'KDIGO', 'ACP',
  'PRISMA', 'CONSORT', 'STROBE', 'GRADE', 'PICO', 'PICOS', 'RCT', 'RCTS', 'MEDLINE',
  'USA', 'UK', 'EU', 'AND', 'THE', 'FOR', 'WITH', 'CI', 'HR', 'RR', 'OR', 'DNA', 'RNA',
  // Drug-class / receptor / enzyme acronyms (hyphens are stripped before this
  // check, so "GLP-1RA" is tested as "GLP1RA"). These are drug classes, not trials.
  'GLP1RA', 'GLP1R', 'GLP1RAS', 'DPP4I', 'PAI', 'PAI1', 'PAII', 'PCSK9', 'ACEI', 'ARB', 'NSAID', 'NSAIDS',
  // Haematology / thrombophilia terms, diseases, and lab phenomena that collide
  // with the trial-acronym shape. A real thrombophilia run harvested "COVID",
  // "PAI-I", "VIII" (factor VIII), and "APCR" (activated protein C resistance) as
  // trial names and fired junk searches — one fetched COVID-19 records into a
  // genetics paper. These are never trials.
  'COVID', 'COVID19', 'SARS', 'SARSCOV', 'SARSCOV2', 'APCR', 'APC',
  'VTE', 'DVT', 'CVT', 'FVL', 'PTM', 'APS', 'HIT', 'DIC', 'TTP', 'ITP', 'VWF', 'ATIII',
  // Bibliographic databases — a review's Methods names the databases searched
  // ("we searched PubMed, EMBASE, and Scopus"), which are trial-shaped ALL-CAPS
  // tokens in a sentence carrying the word "study/search". MEDLINE is already
  // above. A cardiometabolic run harvested "EMBASE" as a trial.
  'EMBASE', 'SCOPUS', 'CINAHL', 'CENTRAL', 'COCHRANE', 'WOS', 'LILACS', 'PSYCINFO',
  // Steatotic-liver-disease nomenclature and its predecessors — diseases, not
  // trials. The SUMMIT tirzepatide abstract names these alongside its endpoints.
  'MASLD', 'MASH', 'MAFLD', 'NAFLD', 'NASH',
  // Patient-reported-outcome instruments and functional endpoints that read as
  // trial acronyms. "KCCQ-CSS" (Kansas City Cardiomyopathy Questionnaire clinical
  // summary score) and the six-minute walk were harvested as trials in a HFpEF run.
  'KCCQ', 'KCCQCSS', 'KCCQOSS', 'KCCQTSS', 'MLHFQ', 'MALO',
]);

// A pure Roman numeral. Coagulation factors are written this way (factor II, V,
// VIII, X, XI, XIII), so a thrombophilia abstract is full of them; none is a
// trial acronym. Matched only for bare tokens (a strong-shape trial carries a
// hyphen or an OUTCOME/CV/HF tail and is never pure Roman).
const ROMAN_NUMERAL_RX = /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;
function isRomanNumeral(core: string): boolean {
  const norm = core.replace(/-/g, '').toUpperCase();
  return norm.length > 0 && ROMAN_NUMERAL_RX.test(norm);
}

// A sentence naming trials usually carries one of these context words. Requiring
// it (unless the token has a strong trial shape) keeps precision high.
const TRIAL_CONTEXT_RX =
  /\b(trial|trials|study|studies|randomi[sz]ed|outcome|outcomes|programme?|cohort|post-?hoc|sub-?study|analysis)\b/i;

// A trial-name-shaped token: an ALL-CAPS core (optionally hyphen-joined), with an
// optional trailing OUTCOME / CV / HF word or a small number ("DECLARE-TIMI 58",
// "EMPA-REG OUTCOME", "VERTIS CV", "PIONEER 6").
const TRIAL_TOKEN_RX = /\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)(?:\s+(OUTCOMES?|CV|HF|\d{1,3}))?\b/g;

// A "strong" trial shape worth capturing even without a nearby context word:
// hyphen-joined caps (DAPA-HF, EMPA-REG) or a trailing OUTCOME/CV/HF.
function hasStrongTrialShape(core: string, tail: string | undefined): boolean {
  return core.includes('-') || tail === 'OUTCOME' || tail === 'OUTCOMES' || tail === 'CV' || tail === 'HF';
}

function looksLikeTrialCore(core: string): boolean {
  // Normalise hyphens so a drug class written "GLP-1" is tested as "GLP1".
  const norm = core.replace(/-/g, '').toUpperCase();
  if (NON_TRIAL_CAPS.has(core) || NON_TRIAL_CAPS.has(norm)) return false;
  // Genetic variants (C677T, A1298C, G20210A) and approved gene symbols (MTHFR,
  // F5) are not trials — a genetics question harvested these as trial names.
  if (/^[A-Z]\d+[A-Z]$/.test(norm)) return false;
  if (isApprovedGeneSymbol(norm) || isApprovedGeneSymbol(core)) return false;
  // Roman numerals are coagulation factors, not trials (factor VIII, factor II).
  if (isRomanNumeral(core)) return false;
  const letters = core.replace(/[^A-Z]/g, '').length;
  // Real trial acronyms are ≥4 letters, or shorter but carrying a hyphen/digit.
  if (letters >= 4) return true;
  return /[-0-9]/.test(core);
}

/** Harvest candidate trial names from retrieved records, most-cited first. Reads
 *  each record's title and abstract; a token counts when its sentence mentions a
 *  trial/study or the token itself has a strong trial shape. */
export function harvestTrialNames(evidence: EvidenceItem[]): string[] {
  const counts = new Map<string, number>();
  for (const record of evidence) {
    const text = `${record.title}. ${record.snippet ?? ''}`;
    for (const sentence of text.split(/(?<=[.;:])\s+/)) {
      const context = TRIAL_CONTEXT_RX.test(sentence);
      for (const m of sentence.matchAll(TRIAL_TOKEN_RX)) {
        const core = m[1] ?? '';
        const tail = m[2];
        if (!looksLikeTrialCore(core)) continue;
        if (!context && !hasStrongTrialShape(core, tail)) continue;
        const name = tail ? `${core} ${tail}` : core;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'versus', 'vs', 'from', 'that', 'this', 'into', 'their', 'which',
  'report', 'compare', 'comparing', 'comparison', 'between', 'among', 'adults', 'patients',
  'people', 'established', 'risk', 'full', 'paper', 'research', 'systematic', 'review',
]);

/** A short topical tail for the trial query — the few most salient content words
 *  of the question — so a short acronym does not match unrelated records. */
function focusTerms(question: string): string {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of question.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 5 || STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    words.push(raw);
    if (words.length >= 4) break;
  }
  return words.join(' ');
}

/**
 * Fetch the primary reports of the landmark trials the retrieved reviews cite, so
 * the manuscript can report per-trial effect sizes. Returns a synthetic specialist
 * result (empty when nothing was found), which the caller merges and de-duplicates
 * with the rest of the evidence.
 */
export async function backfillLandmarkTrials(
  evidence: EvidenceItem[],
  question: string,
  callbacks: SwarmCallbacks,
  opts: { maxTrials?: number; maxPerTrial?: number } = {},
): Promise<SpecialistResult | null> {
  const maxTrials = opts.maxTrials ?? 5;
  const maxPerTrial = opts.maxPerTrial ?? 3;
  const names = harvestTrialNames(evidence).slice(0, maxTrials);
  if (names.length === 0) return null;
  const pubmed = toolRegistry.get('pubmed_search');
  if (!pubmed) return null;

  const tail = focusTerms(question);
  const records: EvidenceItem[] = [];
  let toolCalls = 0;
  callbacks.onToolCall('clinical_research', `Fetching named trials: ${names.join(', ')}`);
  for (const name of names) {
    try {
      const result = await pubmed.execute({
        query: tail ? `${name} ${tail}` : name,
        maxResults: maxPerTrial,
      });
      toolCalls += 1;
      const recs = (result as MedicalSourceResult | undefined)?.results ?? [];
      records.push(...recs);
      callbacks.onToolResult('clinical_research', `trial: ${name}`, recs.length);
    } catch {
      /* best-effort — a failed trial fetch never breaks the paper run */
    }
  }
  if (records.length === 0) return null;
  return {
    agentId: 'clinical_research',
    label: 'Named landmark trials',
    subQuery: `primary reports for ${names.join(', ')}`,
    findings: '',
    evidence: records,
    toolCalls,
  };
}
