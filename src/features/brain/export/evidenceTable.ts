// Evidence-table export — the structured evidence behind a paper as a downloadable
// CSV (opens in Excel / Numbers / Sheets). For each cited record it lists the
// extracted study design, population, comparator, outcomes, sample size, and the
// effect estimates bound to their own CIs and p-values — the same extraction the
// manuscript pipeline builds, re-derived from the cited records so no extra state
// is needed. Local + keyless, like every other export.

import type { EvidenceItem } from '@platform/index';
import { extractEvidenceFromRecords } from '../swarm/evidenceExtraction';
import { referenceUrl } from './citationStyles';
import { downloadTextFile, slugifyFilename } from './messageExport';

// Escape a value for a CSV cell: double embedded quotes and wrap when the value
// contains a comma, quote, or newline. A leading =, +, -, or @ is prefixed with a
// single quote so a spreadsheet cannot execute it as a formula (CSV injection).
function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const HEADER = [
  'Marker',
  'Title',
  'Year',
  'Source',
  'Study design',
  'Population',
  'Comparator',
  'Outcomes',
  'Sample size',
  'Effect estimates',
  'Link',
  'Trusted',
];

/** Build a CSV of the evidence table from the cited records. */
export function buildEvidenceTableCsv(records: EvidenceItem[]): string {
  const extractions = extractEvidenceFromRecords(records);
  const rows = extractions.map((e) => {
    const effects = (e.boundEffects ?? [])
      .map(
        (b) =>
          `${b.measure} ${b.value}${b.ci ? ` (95% CI ${b.ci})` : ''}${b.pValue ? `, p=${b.pValue}` : ''}`,
      )
      .join('; ');
    const record = records[e.evidenceIndex];
    return [
      e.sourceMarker,
      e.title,
      e.year ?? '',
      e.source,
      e.studyDesign,
      e.population,
      e.comparator,
      e.outcomes.join('; '),
      e.sampleSize ?? '',
      effects,
      (record && referenceUrl(record)) || '',
      e.trusted ? 'yes' : 'no',
    ];
  });
  return [HEADER, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function exportEvidenceTableCsv(title: string, records: EvidenceItem[] = []): void {
  if (records.length === 0) return;
  downloadTextFile(
    `${slugifyFilename(title)}-evidence-table.csv`,
    buildEvidenceTableCsv(records),
    'text/csv;charset=utf-8',
  );
}
