/**
 * Deterministic, structured risk-of-bias (RoB) assessment.
 *
 * This module produces domain-level appraisals WITHOUT any model calls —
 * everything is heuristic-based on the extracted metadata (study design,
 * sample-size reporting, comparator mention, source type). It is designed
 * for free-tier / Ollama runs where every token counts.
 *
 * The output mirrors real RoB 2 (for RCTs), ROBINS-I (for non-randomised
 * studies), and AMSTAR-2 (for syntheses) so peer reviewers see a familiar
 * framework, but the caption always labels it as "design-based heuristic".
 */

import type { EvidenceExtraction } from './publicationTypes';

export type RobDomain = {
  name: string;
  rating: 'low' | 'some_concerns' | 'high' | 'unclear';
  justification: string;
};

export type RiskOfBiasAssessment = {
  tool: 'RoB 2' | 'ROBINS-I' | 'AMSTAR-2' | 'design-based heuristic';
  overall: 'low' | 'some_concerns' | 'high' | 'unclear';
  domains: RobDomain[];
  downgradeFactors: string[];
  upgradeFactors: string[];
  gradeCertainty?: 'high' | 'moderate' | 'low' | 'very_low';
};

function hasComparator(extraction: EvidenceExtraction): boolean {
  const comp = extraction.comparator?.toLowerCase() ?? '';
  return comp !== 'not reported in retrieved record' && comp.length > 12;
}

function hasSampleSize(extraction: EvidenceExtraction): boolean {
  return Boolean(extraction.sampleSize && extraction.sampleSize.length > 2);
}

function hasEffectValues(extraction: EvidenceExtraction): boolean {
  return extraction.effectValues.length > 0;
}

function designIs(extraction: EvidenceExtraction, ...patterns: RegExp[]): boolean {
  const design = extraction.studyDesign.toLowerCase();
  return patterns.some((rx) => rx.test(design));
}

/**
 * RoB 2 domains for RCTs — all ratings are conservative because we only
 * have snippets, not protocols or full texts.
 */
function rob2Assessment(extraction: EvidenceExtraction): RiskOfBiasAssessment {
  const domains: RobDomain[] = [
    {
      name: 'Randomisation process',
      rating: 'unclear',
      justification:
        'The retrieved snippet does not describe the randomisation method or allocation concealment.',
    },
    {
      name: 'Deviations from intended interventions',
      rating: 'unclear',
      justification: 'No information on blinding or adherence is available in the retrieved text.',
    },
    {
      name: 'Missing outcome data',
      rating: hasSampleSize(extraction) ? 'some_concerns' : 'unclear',
      justification: hasSampleSize(extraction)
        ? 'A sample size is reported, but attrition and intention-to-treat details are not extractable.'
        : 'Sample size not extractable; risk of attrition bias cannot be assessed.',
    },
    {
      name: 'Measurement of the outcome',
      rating: hasEffectValues(extraction) ? 'some_concerns' : 'unclear',
      justification: hasEffectValues(extraction)
        ? 'Effect estimates are reported, but outcome assessor blinding and measurement validity are not described.'
        : 'No quantitative outcomes extracted; measurement bias cannot be assessed.',
    },
    {
      name: 'Selection of the reported result',
      rating: 'some_concerns',
      justification:
        'Single-study snippets do not allow appraisal of multiple outcomes or selective reporting.',
    },
  ];

  const ratings = domains.map((d) => d.rating);
  const highCount = ratings.filter((r) => r === 'high').length;
  const someCount = ratings.filter((r) => r === 'some_concerns').length;
  const lowCount = ratings.filter((r) => r === 'low').length;

  let overall: RiskOfBiasAssessment['overall'] = 'unclear';
  if (highCount > 0) overall = 'high';
  else if (someCount > 0) overall = 'some_concerns';
  else if (lowCount === domains.length) overall = 'low';

  const downgradeFactors: string[] = ['risk of bias (snippet-based assessment)'];
  if (!hasSampleSize(extraction)) downgradeFactors.push('imprecision (sample size not reported)');
  if (!hasEffectValues(extraction)) downgradeFactors.push('indirectness (quantitative outcomes not extracted)');

  return {
    tool: 'RoB 2',
    overall,
    domains,
    downgradeFactors,
    upgradeFactors: [],
    gradeCertainty: 'low',
  };
}

/**
 * ROBINS-I domains for observational studies.
 */
function robinsIAssessment(extraction: EvidenceExtraction): RiskOfBiasAssessment {
  const design = extraction.studyDesign.toLowerCase();
  const isRegistry = /registry/.test(design);

  const domains: RobDomain[] = [
    {
      name: 'Confounding',
      rating: 'high',
      justification:
        'Observational designs are inherently susceptible to confounding; no covariate adjustment is extractable from snippets.',
    },
    {
      name: 'Selection of participants',
      rating: isRegistry ? 'some_concerns' : 'high',
      justification: isRegistry
        ? 'Registry records suggest a defined cohort, but eligibility criteria are not fully extractable.'
        : 'Selection criteria and representativeness are not described in the retrieved text.',
    },
    {
      name: 'Classification of interventions/exposures',
      rating: 'unclear',
      justification: 'Exposure ascertainment method is not available in the snippet.',
    },
    {
      name: 'Departures from intended interventions',
      rating: 'unclear',
      justification: 'Adherence and co-intervention data are not extractable.',
    },
    {
      name: 'Missing data',
      rating: hasSampleSize(extraction) ? 'some_concerns' : 'high',
      justification: hasSampleSize(extraction)
        ? 'A sample size is extractable, but missing-data handling is not described.'
        : 'No sample size available; risk of attrition and selection bias cannot be gauged.',
    },
    {
      name: 'Measurement of outcomes',
      rating: hasEffectValues(extraction) ? 'some_concerns' : 'unclear',
      justification: hasEffectValues(extraction)
        ? 'Outcomes are partially quantified, but assessor blinding and validity are unknown.'
        : 'Outcome measurement details are not extractable.',
    },
    {
      name: 'Selection of the reported result',
      rating: 'some_concerns',
      justification: 'Single-study snippets do not permit appraisal of multiple analyses or selective reporting.',
    },
  ];

  const ratings = domains.map((d) => d.rating);
  const highCount = ratings.filter((r) => r === 'high').length;

  let overall: RiskOfBiasAssessment['overall'] = 'some_concerns';
  if (highCount >= 2) overall = 'high';

  const downgradeFactors: string[] = ['risk of bias (observational design)'];
  if (!hasSampleSize(extraction)) downgradeFactors.push('imprecision');
  if (!hasComparator(extraction)) downgradeFactors.push('indirectness (no comparator described)');

  return {
    tool: 'ROBINS-I',
    overall,
    domains,
    downgradeFactors,
    upgradeFactors: [],
    gradeCertainty: 'very_low',
  };
}

/**
 * AMSTAR-2 critical domains for systematic reviews / meta-analyses.
 */
function amstar2Assessment(extraction: EvidenceExtraction): RiskOfBiasAssessment {
  const domains: RobDomain[] = [
    {
      name: 'Comprehensive literature search',
      rating: 'unclear',
      justification: 'Search strategy and databases are not described in the retrieved snippet.',
    },
    {
      name: 'Duplicate study selection & data extraction',
      rating: 'unclear',
      justification: 'No information on dual review or extraction is extractable.',
    },
    {
      name: 'List of excluded studies with justification',
      rating: 'unclear',
      justification: 'Excluded studies are not visible in the snippet.',
    },
    {
      name: 'Risk of bias assessment of included studies',
      rating: 'unclear',
      justification: 'The review may have performed RoB assessment, but it is not extractable here.',
    },
    {
      name: 'Appropriateness of meta-analysis methods',
      rating: hasEffectValues(extraction) ? 'some_concerns' : 'unclear',
      justification: hasEffectValues(extraction)
        ? 'Pooled estimates are reported, but heterogeneity handling and model choice are not described.'
        : 'No pooled estimates extracted; meta-analysis methods cannot be assessed.',
    },
    {
      name: 'Consideration of risk of bias when interpreting results',
      rating: 'unclear',
      justification: 'Interpretation framework is not visible in the snippet.',
    },
    {
      name: 'Assessment of publication bias',
      rating: 'unclear',
      justification: 'Funnel-plot or Egger test mention is not extractable.',
    },
  ];

  return {
    tool: 'AMSTAR-2',
    overall: 'some_concerns',
    domains,
    downgradeFactors: ['risk of bias in included studies (not assessable from snippet)'],
    upgradeFactors: [],
    gradeCertainty: 'low',
  };
}

/**
 * Fallback heuristic for unclassifiable or weak designs.
 */
function heuristicAssessment(extraction: EvidenceExtraction): RiskOfBiasAssessment {
  const design = extraction.studyDesign.toLowerCase();
  let overall: RiskOfBiasAssessment['overall'] = 'unclear';
  if (/cross-sectional|case report|case series|narrative review/.test(design)) {
    overall = 'high';
  }

  const domains: RobDomain[] = [
    {
      name: 'Study design appropriateness',
      rating: overall,
      justification: `Design "${extraction.studyDesign}" carries inherent methodological limitations for causal inference.`,
    },
    {
      name: 'Reporting completeness',
      rating: hasSampleSize(extraction) && hasEffectValues(extraction) ? 'some_concerns' : 'high',
      justification:
        'Retrieved text lacks full methodology; key fields (sample size, effect estimates, comparator) may be missing.',
    },
  ];

  return {
    tool: 'design-based heuristic',
    overall,
    domains,
    downgradeFactors: ['study-design limitations', 'incomplete reporting in retrieved text'],
    upgradeFactors: [],
    gradeCertainty: 'very_low',
  };
}

export function assessRiskOfBias(extraction: EvidenceExtraction): RiskOfBiasAssessment {
  if (designIs(extraction, /randomi[sz]ed|\brct\b/)) return rob2Assessment(extraction);
  if (designIs(extraction, /meta-analysis|systematic review/)) return amstar2Assessment(extraction);
  if (designIs(extraction, /cohort|case[- ]control|cross[- ]sectional|registry/)) return robinsIAssessment(extraction);
  return heuristicAssessment(extraction);
}

/** Format a structured RoB assessment into a compact table row string. */
export function formatRobSummary(assessment: RiskOfBiasAssessment): string {
  const domainList = assessment.domains.map((d) => `${d.name}: ${d.rating.replace(/_/g, ' ')}`).join('; ');
  const grade = assessment.gradeCertainty ? ` | GRADE: ${assessment.gradeCertainty.replace(/_/g, ' ')}` : '';
  return `${assessment.tool} — overall ${assessment.overall.replace(/_/g, ' ')}${grade} | ${domainList}`;
}

/** Flatten domains for CSV/tabular export. */
export function flattenRobDomains(assessment: RiskOfBiasAssessment): Record<string, string> {
  const out: Record<string, string> = {
    tool: assessment.tool,
    overall: assessment.overall,
    grade: assessment.gradeCertainty ?? 'n/a',
  };
  for (const d of assessment.domains) {
    out[d.name] = d.rating;
  }
  return out;
}
