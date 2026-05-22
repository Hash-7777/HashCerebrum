import type { EvidenceItem } from '@platform/index';

const SNIPPET_CHARS = 320;

export interface FormatEvidenceOptions {
  /** Zero-based index used to build the [S#] marker. */
  index: number;
  /** Optional prefix for the marker (default 'S'). */
  markerPrefix?: string | undefined;
  /** Max characters for the snippet (default 320). */
  snippetChars?: number | undefined;
}

/**
 * Shared evidence formatter used by the boss synthesizer, manuscript writer,
 * and specialist result renderer. Keeps the citation shape identical across
 * the pipeline so the model sees a consistent [S#] scheme.
 */
export function formatEvidenceItem(
  record: EvidenceItem,
  options: FormatEvidenceOptions,
): string {
  const { index, markerPrefix = 'S', snippetChars = SNIPPET_CHARS } = options;
  const year = record.year ? ` (${record.year})` : '';
  const id = record.identifiers?.pmid
    ? ` PMID:${record.identifiers.pmid}`
    : record.identifiers?.doi
      ? ` DOI:${record.identifiers.doi}`
      : '';
  const snippet = record.snippet
    ? ` — ${record.snippet.replace(/\s+/g, ' ').slice(0, snippetChars)}`
    : '';
  return `[${markerPrefix}${index + 1}] ${record.source.toUpperCase()}${year} ${record.title}.${id}${snippet}`;
}

/**
 * Format a flat list of evidence items into newline-separated citation lines.
 */
export function formatEvidenceList(
  evidence: EvidenceItem[],
  opts?: { startIndex?: number; markerPrefix?: string; snippetChars?: number; maxItems?: number },
): string {
  if (evidence.length === 0) return '(no source records were retrieved)';
  const start = opts?.startIndex ?? 0;
  const slice = opts?.maxItems !== undefined ? evidence.slice(0, opts.maxItems) : evidence;
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
