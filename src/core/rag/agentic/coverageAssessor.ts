/**
 * Coverage Assessor — deterministic query-to-chunks coverage analysis.
 *
 * Given a query and a set of retrieved chunks, determines:
 * 1. Which query concepts are covered by the chunks
 * 2. Which concepts are missing (gaps)
 * 3. A coverage score (0-1)
 * 4. Whether re-retrieval is warranted
 *
 * Zero model calls. Uses the same concept-group logic as the swarm's
 * relevance ranking for consistency.
 */

import type { RagChunk } from '../types';

// Generic academic words that should not count as "concepts" for coverage.
const COVERAGE_FILLER = new Set([
  'about', 'after', 'against', 'among', 'and', 'any', 'are', 'between', 'both',
  'compare', 'comparison', 'does', 'effect', 'effects', 'evidence', 'for', 'from',
  'have', 'high', 'how', 'into', 'its', 'low', 'more', 'most', 'only', 'over',
  'patient', 'patients', 'research', 'review', 'risk', 'safety', 'than', 'that',
  'their', 'them', 'these', 'this', 'those', 'using', 'versus', 'what', 'which',
  'with', 'within', 'your', 'make', 'write', 'draft', 'create', 'generate',
  'produce', 'compose', 'prepare', 'give', 'want', 'need', 'please', 'full',
  'complete', 'comprehensive', 'detailed', 'thorough', 'professional',
  'publishable', 'proper', 'manuscript', 'article', 'report', 'document',
  'regarding', 'concerning', 'statistics', 'statistical', 'stats', 'numbers',
  'numeric', 'data', 'analysis', 'long', 'short', 'term', 'run', 'time',
  'duration', 'people', 'individual', 'individuals', 'population', 'treatment',
  'therapy', 'intervention', 'disease', 'condition', 'disorder', 'outcome',
  'result', 'finding', 'association', 'relationship',
]);

// Medical synonym groups for coverage expansion.
const MEDICAL_SYNONYMS: Record<string, string[]> = {
  renal: ['kidney'],
  kidney: ['renal'],
  cardiac: ['heart', 'cardiovascular'],
  heart: ['cardiac', 'cardiovascular'],
  cardiovascular: ['cardiac', 'heart'],
  hepatic: ['liver'],
  liver: ['hepatic'],
  pulmonary: ['lung'],
  lung: ['pulmonary'],
  gastric: ['stomach', 'gastrointestinal'],
  gastrointestinal: ['gastric', 'gi'],
  statin: ['hmg-coa reductase inhibitor', 'simvastatin', 'atorvastatin', 'rosuvastatin'],
  statins: ['hmg-coa reductase inhibitors', 'simvastatin', 'atorvastatin', 'rosuvastatin'],
  asthma: ['airway inflammation', 'bronchial hyperresponsiveness', 'airway remodeling'],
  copd: ['chronic obstructive pulmonary disease', 'emphysema', 'chronic bronchitis'],
  diabetes: ['diabetic', 'hyperglycemia', 't2dm', 't1dm'],
  hypertension: ['high blood pressure', 'htn'],
  obesity: ['overweight', 'bmi', 'adiposity'],
  warfarin: ['vitamin k antagonist', 'coumarin'],
  aspirin: ['acetylsalicylic acid', 'asa'],
  nsaid: ['nonsteroidal anti-inflammatory', 'ibuprofen', 'naproxen', 'diclofenac'],
  nsaids: ['nonsteroidal anti-inflammatory drugs', 'ibuprofen', 'naproxen', 'diclofenac'],
};

function cleanToken(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function conceptGroups(query: string): string[][] {
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !COVERAGE_FILLER.has(cleanToken(w))),
    ),
  ];
  return terms.map((term) => [term, ...(MEDICAL_SYNONYMS[term] ?? [])]);
}

export function coreConceptGroups(query: string): string[][] {
  const generic = new Set([
    'effect', 'effects', 'impact', 'impacts', 'influence', 'role', 'use', 'using',
    'long', 'term', 'short', 'run', 'time', 'duration',
  ]);
  const all = conceptGroups(query);
  return all.filter((group) => !generic.has(group[0]!));
}

export interface CoverageAssessment {
  totalConcepts: number;
  coveredConcepts: number;
  missingConcepts: string[];
  coverageScore: number; // 0-1
  coreCovered: number;
  coreTotal: number;
  coreScore: number; // 0-1
  needsReRetrieve: boolean;
  gapNote: string | null;
}

export function assessCoverage(query: string, chunks: RagChunk[]): CoverageAssessment {
  const groups = conceptGroups(query);
  const coreGroups = coreConceptGroups(query);

  if (groups.length === 0) {
    return {
      totalConcepts: 0,
      coveredConcepts: 0,
      missingConcepts: [],
      coverageScore: 0,
      coreCovered: 0,
      coreTotal: 0,
      coreScore: 0,
      needsReRetrieve: chunks.length < 3,
      gapNote: chunks.length < 3 ? 'Very few chunks retrieved; broaden search.' : null,
    };
  }

  const covered = new Set<number>();
  const coreCovered = new Set<number>();

  for (const chunk of chunks) {
    const text = `${chunk.title} ${chunk.text}`.toLowerCase();
    for (let i = 0; i < groups.length; i += 1) {
      if (groups[i]!.some((syn) => text.includes(syn))) covered.add(i);
    }
    for (let i = 0; i < coreGroups.length; i += 1) {
      if (coreGroups[i]!.some((syn) => text.includes(syn))) coreCovered.add(i);
    }
  }

  const missing = groups
    .map((g, i) => ({ term: g[0]!, idx: i }))
    .filter(({ idx }) => !covered.has(idx))
    .map(({ term }) => term);

  const coverageScore = groups.length > 0 ? covered.size / groups.length : 0;
  const coreScore = coreGroups.length > 0 ? coreCovered.size / coreGroups.length : 0;

  // Re-retrieve if coverage is poor OR core concepts are missing
  const needsReRetrieve = coverageScore < 0.6 || coreScore < 0.5 || chunks.length < 3;

  const gapNote =
    missing.length > 0
      ? `Retrieved chunks lack direct evidence for: ${missing.join(', ')}.`
      : null;

  return {
    totalConcepts: groups.length,
    coveredConcepts: covered.size,
    missingConcepts: missing,
    coverageScore,
    coreCovered: coreCovered.size,
    coreTotal: coreGroups.length,
    coreScore,
    needsReRetrieve,
    gapNote,
  };
}
