/**
 * Parse structured effect-size rows supplied by the user in the research
 * question, and convert them into synthetic EvidenceExtractions that feed
 * the deterministic meta-analysis engine.
 *
 * This is the fix for I2: the paper must compute statistics on its OWN
 * data, not only on effect sizes auto-extracted from retrieved abstracts.
 */

import type { EvidenceExtraction, ExtractedEffectValue } from './publicationTypes';

export interface PromptEffectRow {
  label: string;
  measure: 'HR' | 'OR' | 'RR';
  point: number;
  ciLow: number;
  ciHigh: number;
  sampleSize: number | undefined;
}

const ROW_RX =
  /^\s*(?:[-•*]\s*)?(.+?)\s*(?:\(n\s*=\s*(\d+)\))?\s*[:\-]\s*(HR|OR|RR)\s*(?:=|of)?\s*(\d+(?:\.\d+)?)\s*(?:\(95%\s*CI\s*(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)\))?\s*$/im;

const BLOCK_RX = /(?:data|trials?|studies?|effect sizes?)\s*[:\-]\s*([\s\S]*?)(?:\n\n|\n(?:requirements?|instructions?|context|outline|must|should)\b|$)/i;

/**
 * Search the research question for a structured data block or individual
 * effect-size rows. Accepts short HR/OR/RR safely because these appear in
 * a structured row, not free prose.
 */
export function parsePromptEffectRows(question: string): PromptEffectRow[] {
  const rows: PromptEffectRow[] = [];

  // Try to find an explicit data block first.
  const blockMatch = BLOCK_RX.exec(question);
  const searchText = blockMatch ? blockMatch[1]! : question;

  for (const line of searchText.split('\n')) {
    const m = ROW_RX.exec(line);
    if (!m) continue;
    const label = m[1]!.trim();
    const measure = m[3]!.toUpperCase() as PromptEffectRow['measure'];
    const point = Number.parseFloat(m[4]!);
    const ciLow = m[5] ? Number.parseFloat(m[5]) : Number.NaN;
    const ciHigh = m[6] ? Number.parseFloat(m[6]) : Number.NaN;
    const sampleSize = m[2] ? Number.parseInt(m[2], 10) : undefined;

    if (
      Number.isFinite(point) &&
      point > 0 &&
      point <= 100 &&
      Number.isFinite(ciLow) &&
      Number.isFinite(ciHigh) &&
      ciLow > 0 &&
      ciHigh > ciLow &&
      point >= ciLow * 0.5 &&
      point <= ciHigh * 2
    ) {
      rows.push({ label, measure, point, ciLow, ciHigh, sampleSize });
    }
  }

  return rows;
}

function measureLongForm(measure: PromptEffectRow['measure']): string {
  switch (measure) {
    case 'HR':
      return 'hazard ratio';
    case 'OR':
      return 'odds ratio';
    case 'RR':
      return 'risk ratio';
  }
}

function toLongFormText(row: PromptEffectRow): string {
  const measure = measureLongForm(row.measure);
  const nText = row.sampleSize ? ` (n=${row.sampleSize})` : '';
  return `${measure} ${row.point} (95% CI ${row.ciLow}-${row.ciHigh})${nText}`;
}

let syntheticId = 0;

function nextSyntheticId(): string {
  syntheticId += 1;
  return `prompt-${syntheticId}`;
}

/** Reset the synthetic id counter — call once per pipeline run. */
export function resetSyntheticIds(): void {
  syntheticId = 0;
}

/**
 * Convert parsed prompt rows into synthetic EvidenceExtractions that the
 * existing meta-analysis engine can consume unchanged.
 */
export function toSyntheticExtractions(rows: PromptEffectRow[]): EvidenceExtraction[] {
  return rows.map((row, index) => {
    const longForm = toLongFormText(row);
    const effectValues: ExtractedEffectValue[] = [
      {
        label: measureLongForm(row.measure),
        value: String(row.point),
        sourceText: longForm,
      },
      {
        label: 'confidence interval',
        value: `${row.ciLow}-${row.ciHigh}`,
        sourceText: `95% CI ${row.ciLow}-${row.ciHigh}`,
      },
    ];

    return {
      id: nextSyntheticId(),
      sourceMarker: `[P${index + 1}]`,
      evidenceIndex: -1 - index, // negative indices distinguish prompt data from retrieved records
      source: 'pubmed',
      title: `${row.label} — author-supplied trial data`,
      year: null,
      identifiers: {},
      studyDesign: 'randomized clinical trial',
      population: 'Author-supplied trial population',
      exposureOrIntervention: 'Author-specified intervention',
      comparator: 'Author-specified comparator',
      outcomes: ['Author-specified primary outcome'],
      sampleSize: row.sampleSize ? `n=${row.sampleSize}` : null,
      effectValues,
      limitations: ['Data supplied by the author rather than extracted from a retrieved source record.'],
      keyFinding: longForm,
      trusted: true,
    };
  });
}
