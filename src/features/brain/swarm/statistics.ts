import type { AnalysisPlan, DatasetColumnSummary, UploadedDatasetSummary } from './publicationTypes';
import { deriveAnalysisPlan } from './stats/analysisPlan';

const MAX_PREVIEW_ROWS = 6;
const MAX_LEVELS = 8;
const MAX_DATASET_BYTES = 2_000_000;

function detectDelimiter(header: string): ',' | '\t' {
  return header.split('\t').length > header.split(',').length ? '\t' : ',';
}

function parseDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseDelimited(text: string): { delimiter: ',' | '\t'; headers: string[]; rows: Record<string, string>[] } {
  if (text.length > MAX_DATASET_BYTES) {
    throw new Error('Dataset is too large for the in-app statistics preview. Use a file under 2 MB.');
  }
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((line) => line.trim());
  const headerLine = lines[0];
  if (!headerLine) throw new Error('Dataset has no header row.');
  const delimiter = detectDelimiter(headerLine);
  const headers = parseDelimitedLine(headerLine, delimiter).map((header, index) => header || `column_${index + 1}`);
  // Deduplicate headers so duplicate column names don't silently overwrite data.
  const seen = new Set<string>();
  const uniqueHeaders = headers.map((header) => {
    let unique = header;
    let suffix = 2;
    while (seen.has(unique)) {
      unique = `${header}_${suffix}`;
      suffix += 1;
    }
    seen.add(unique);
    return unique;
  });
  if (headers.length < 2) throw new Error('Dataset must contain at least two columns.');
  const rows = lines.slice(1).map((line) => {
    const cells = parseDelimitedLine(line, delimiter);
    const row: Record<string, string> = {};
    uniqueHeaders.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    return row;
  });
  if (rows.length === 0) throw new Error('Dataset has no data rows.');
  return { delimiter, headers: uniqueHeaders, rows };
}

function numericValues(rows: Record<string, string>[], column: string): number[] {
  return rows
    .map((row) => row[column]?.trim() ?? '')
    .filter(Boolean)
    .map((value) => Number(value.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
}

function round(value: number): number {
  return Number(value.toFixed(Math.abs(value) >= 100 ? 1 : 3));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function sd(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function columnSummary(rows: Record<string, string>[], column: string): DatasetColumnSummary {
  const rawValues = rows.map((row) => row[column]?.trim() ?? '');
  const nonMissing = rawValues.filter(Boolean).length;
  const missing = rows.length - nonMissing;
  const values = numericValues(rows, column);
  const numericCoverage = nonMissing > 0 ? values.length / nonMissing : 0;

  if (values.length > 0 && numericCoverage >= 0.85) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      name: column,
      type: 'numeric',
      nonMissing,
      missing,
      mean: round(mean),
      sd: round(sd(values, mean)),
      median: round(median(values)),
      min: round(Math.min(...values)),
      max: round(Math.max(...values)),
    };
  }

  const counts = new Map<string, number>();
  rawValues.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const levels = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LEVELS)
    .map(([value, count]) => ({ value, count }));
  return { name: column, type: 'categorical', nonMissing, missing, levels };
}

async function sha256Text(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  let fallback = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    fallback ^= text.charCodeAt(i);
    fallback = Math.imul(fallback, 16777619);
  }
  return `fnv-${(fallback >>> 0).toString(16).padStart(8, '0')}`;
}

async function sha256Buffer(buffer: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // FNV-1a fallback on raw bytes
  const bytes = new Uint8Array(buffer);
  let fallback = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    fallback ^= bytes[i]!;
    fallback = Math.imul(fallback, 16777619);
  }
  return `fnv-${(fallback >>> 0).toString(16).padStart(8, '0')}`;
}

async function parseXlsx(buffer: ArrayBuffer): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel workbook has no sheets.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('Excel workbook has no readable sheets.');
  const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  if (json.length === 0) throw new Error('Excel sheet is empty.');
  const rawHeaders = (json[0] as unknown[]).map((cell, index) => {
    const value = cell == null ? '' : String(cell);
    return value || `column_${index + 1}`;
  });
  // Deduplicate headers so duplicate column names don't silently overwrite data.
  const seen = new Set<string>();
  const headers = rawHeaders.map((header) => {
    let unique = header;
    let suffix = 2;
    while (seen.has(unique)) {
      unique = `${header}_${suffix}`;
      suffix += 1;
    }
    seen.add(unique);
    return unique;
  });
  if (headers.length < 2) throw new Error('Dataset must contain at least two columns.');
  const rows = json.slice(1).map((row) => {
    const cells = row as unknown[];
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      const raw = cells[index];
      record[header] = raw == null ? '' : String(raw);
    });
    return record;
  });
  return { headers, rows: rows.filter((row) => Object.values(row).some((v) => v.trim())) };
}

export async function summarizeDatasetText(filename: string, text: string): Promise<UploadedDatasetSummary> {
  const { delimiter, headers, rows } = parseDelimited(text);
  return {
    filename,
    sha256: await sha256Text(text),
    rows: rows.length,
    columns: headers,
    delimiter,
    columnSummaries: headers.map((header) => columnSummary(rows, header)),
    previewRows: rows.slice(0, MAX_PREVIEW_ROWS),
    // The inferential statistics engine derives and runs its analysis plan
    // once, here, where the parsed rows are still in scope.
    inferential: deriveAnalysisPlan(headers, rows),
  };
}

export async function summarizeDatasetXlsx(filename: string, buffer: ArrayBuffer): Promise<UploadedDatasetSummary> {
  if (buffer.byteLength > MAX_DATASET_BYTES) {
    throw new Error('Dataset is too large for the in-app statistics preview. Use a file under 2 MB.');
  }
  const { headers, rows } = await parseXlsx(buffer);
  if (rows.length === 0) throw new Error('Excel sheet has no data rows.');
  return {
    filename,
    sha256: await sha256Buffer(buffer),
    rows: rows.length,
    columns: headers,
    delimiter: null,
    columnSummaries: headers.map((header) => columnSummary(rows, header)),
    previewRows: rows.slice(0, MAX_PREVIEW_ROWS),
    inferential: deriveAnalysisPlan(headers, rows),
  };
}

/** Prompt block listing the validated, in-app computed inferential analyses. */
function analysisPlanForPrompt(plan: AnalysisPlan): string {
  if (!plan.generated) {
    return `Computed inferential statistics: none.${plan.notes.length ? ` ${plan.notes.join(' ')}` : ''}
Allowed use: narrate the computed descriptive statistics only. Do not report p-values, odds ratios, hazard ratios, confidence intervals, or subgroup effects — none were validly computed for this dataset.`;
  }
  const lines = [
    'Computed inferential statistics (computed in-app by the validated analysis engine — you MAY narrate these exact numbers):',
  ];
  for (const analysis of plan.analyses) lines.push(`- ${analysis.reportText}`);
  if (plan.subgroups) lines.push(`- ${plan.subgroups.reportText}`);
  if (plan.survival) lines.push(`- ${plan.survival.reportText}`);
  if (plan.notes.length) lines.push(`Caveats: ${plan.notes.join(' ')}`);
  lines.push(
    'Allowed use: in Methods, name the statistical tests used; in Results, narrate these computed estimates, confidence intervals, and p-values using these exact numbers. Do NOT compute or invent any other statistic.',
  );
  return lines.join('\n');
}

export function datasetSummaryForPrompt(dataset: UploadedDatasetSummary): string {
  const columns = dataset.columnSummaries
    .map((column) => {
      if (column.type === 'numeric') {
        return `${column.name}: numeric, n=${column.nonMissing}, missing=${column.missing}, mean=${column.mean}, SD=${column.sd}, median=${column.median}, range=${column.min}-${column.max}`;
      }
      const levels = column.levels?.map((level) => `${level.value}=${level.count}`).join(', ') || 'no non-missing levels';
      return `${column.name}: categorical, n=${column.nonMissing}, missing=${column.missing}, top levels: ${levels}`;
    })
    .join('\n');
  const inferentialBlock = dataset.inferential
    ? analysisPlanForPrompt(dataset.inferential)
    : 'Computed inferential statistics: none. Allowed use: narrate the computed descriptive statistics only.';
  return `Dataset: ${dataset.filename}
SHA-256: ${dataset.sha256}
Rows: ${dataset.rows}
Columns: ${dataset.columns.join(', ')}
Computed descriptive statistics:
${columns}

${inferentialBlock}`;
}
