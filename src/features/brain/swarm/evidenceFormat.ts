import type { EvidenceItem } from '@platform/index';
import { neutralizeInjection } from './evidenceSanitize';

const SNIPPET_CHARS = 320;

export interface FormatEvidenceOptions {
  /** Zero-based index used to build the [#] marker. */
  index: number;
  /** Optional prefix for the marker (default ''). */
  markerPrefix?: string | undefined;
  /** Max characters for the snippet (default 320). */
  snippetChars?: number | undefined;
}

/**
 * Shared evidence formatter used by the boss synthesizer, manuscript writer,
 * and specialist result renderer. Keeps the citation shape identical across
 * the pipeline so the model sees a consistent [#] scheme.
 */
export function formatEvidenceItem(
  record: EvidenceItem,
  options: FormatEvidenceOptions,
): string {
  const { index, markerPrefix = '', snippetChars = SNIPPET_CHARS } = options;
  const year = record.year ? ` (${record.year})` : '';
  const id = record.identifiers?.pmid
    ? ` PMID:${record.identifiers.pmid}`
    : record.identifiers?.doi
      ? ` DOI:${record.identifiers.doi}`
      : '';
  // Title and snippet are untrusted source text — neutralize any embedded
  // prompt-injection before it reaches the model as part of the citation line.
  const title = neutralizeInjection(record.title);
  const snippet = record.snippet
    ? ` — ${neutralizeInjection(record.snippet.replace(/\s+/g, ' ')).slice(0, snippetChars)}`
    : '';
  return `[${markerPrefix}${index + 1}] ${record.source.toUpperCase()}${year} ${title}.${id}${snippet}`;
}

/**
 * Format a flat list of evidence items into newline-separated citation lines.
 */
export function formatEvidenceList(
  evidence: EvidenceItem[],
  opts?: { startIndex?: number; markerPrefix?: string; snippetChars?: number; maxItems?: number },
): string {
  const start = opts?.startIndex ?? 0;
  const slice = opts?.maxItems !== undefined ? evidence.slice(0, opts.maxItems) : evidence;
  if (slice.length === 0) return '(no source records were retrieved)';
  return slice
    .map((record, offset) =>
      formatEvidenceItem(record, {
        index: start + offset,
        markerPrefix: opts?.markerPrefix,
        snippetChars: opts?.snippetChars,
      }),
    )
    .join('\n');
}
