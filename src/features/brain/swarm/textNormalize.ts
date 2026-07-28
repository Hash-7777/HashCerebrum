// Shared text helpers for the paper pipeline and the modules split out of it.
// Kept separate so an extracted module never has to import back into
// paperPipeline for a small helper, which would create an import cycle.

import type { EvidenceItem } from '@platform/index';

/** Collapse runs of whitespace and trim. Null and undefined become ''. */
export function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Flatten a retrieved record into one searchable string — title, snippet, year,
 * authors, identifiers and URL. Used wherever something needs to ask "does this
 * record say X?" without caring which field it said it in.
 */
export function recordText(record: EvidenceItem): string {
  return [
    record.title,
    record.snippet,
    record.year,
    ...record.authors,
    ...Object.values(record.identifiers ?? {}),
    record.url,
  ].filter(Boolean).join(' ');
}
