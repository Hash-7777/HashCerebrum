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

// ── Record identity ─────────────────────────────────────────────────────────
// One retrieved record can arrive from several sources with different titles,
// so identity is taken from the strongest stable key it carries — DOI, then
// PMID, then URL — and only falls back to normalised title plus year. Shared
// because both the publication artifact and its figures count unique records,
// and each counting them differently would be a quietly wrong number.

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeDoi(doi: string): string {
  return doi.trim().toLowerCase().replace(/^https?:\/\/doi\.org\//, '').replace(/^doi:/, '');
}

export function evidenceIdentity(record: EvidenceItem): string {
  const doi = record.identifiers?.doi?.trim().toLowerCase();
  if (doi) return `doi:${normalizeDoi(doi)}`;
  const pmid = record.identifiers?.pmid?.trim().toLowerCase();
  if (pmid) return `pmid:${pmid}`;
  const url = record.url?.trim().toLowerCase();
  if (url) return `url:${url}`;
  return `title:${normalizeText(record.title).toLowerCase()}-${record.year ?? ''}`;
}

