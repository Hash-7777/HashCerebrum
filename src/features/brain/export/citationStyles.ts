// Citation-style formatting — the pure core that turns a retrieved evidence
// record into a reference-list line in a chosen scholarly style.
//
// The manuscript pipeline numbers references in order of first citation
// (Vancouver), and that numbering is preserved across every style: only the
// *text* of each reference line changes. Vancouver is the default and matches
// the long-standing output exactly, so switching styles never renumbers the
// body or changes which records are cited. Kept pure (no I/O, no React) so it is
// fully unit-testable.

import type { EvidenceItem } from '@platform/index';

export type CitationStyle = 'vancouver' | 'apa' | 'harvard';

export const CITATION_STYLES: { value: CitationStyle; label: string }[] = [
  { value: 'vancouver', label: 'Vancouver' },
  { value: 'apa', label: 'APA' },
  { value: 'harvard', label: 'Harvard' },
];

const SOURCE_LABELS: Record<EvidenceItem['source'], string> = {
  pubmed: 'PubMed',
  europepmc: 'Europe PMC',
  openalex: 'OpenAlex',
  ctgov: 'ClinicalTrials.gov',
  openfda: 'openFDA',
  rxnorm: 'RxNorm',
  library: 'Imported document',
};

interface ParsedName {
  family: string;
  initials: string; // e.g. "J.A."
  given: string; // raw given-name portion
}

/** Split a free-text author name ("John A. Smith") into family + initials. */
function parseName(raw: string): ParsedName {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { family: '', initials: '', given: '' };
  // "Smith, John A." → family before the comma.
  const comma = name.indexOf(',');
  if (comma > 0) {
    const family = name.slice(0, comma).trim();
    const given = name.slice(comma + 1).trim();
    return { family, given, initials: initialsOf(given) };
  }
  const parts = name.split(' ');
  if (parts.length === 1) return { family: parts[0]!, initials: '', given: '' };
  const family = parts.at(-1)!;
  const given = parts.slice(0, -1).join(' ');
  return { family, given, initials: initialsOf(given) };
}

function initialsOf(given: string): string {
  return given
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}.`)
    .join('');
}

function yearText(record: EvidenceItem): string | null {
  if (record.year === null || record.year === undefined || record.year === '') return null;
  const n = typeof record.year === 'number' ? record.year : Number(record.year);
  return Number.isFinite(n) ? String(n) : String(record.year);
}

function trailingId(record: EvidenceItem): string {
  if (record.identifiers?.doi) return ` https://doi.org/${record.identifiers.doi}`;
  if (record.identifiers?.pmid) return ` PMID: ${record.identifiers.pmid}.`;
  if (record.url) return ` Available from: ${record.url}`;
  return '';
}

// Page locality for an imported library document, when the extractor provided
// a page number (e.g. " p. 12.").
function pageSuffix(record: EvidenceItem): string {
  const page = record.identifiers?.page;
  return page ? ` p. ${page}.` : '';
}

// ── Vancouver (default — preserves the existing output verbatim) ──────────────

function vancouverAuthors(record: EvidenceItem): string {
  if (record.authors.length === 0) return SOURCE_LABELS[record.source];
  const authors = record.authors.slice(0, 6).map((a) => a.trim()).filter(Boolean);
  if (authors.length === 0) return SOURCE_LABELS[record.source];
  const suffix = record.authors.length > authors.length ? ' et al.' : '';
  return `${authors.join(', ')}${suffix}`;
}

function vancouver(record: EvidenceItem): string {
  const year = yearText(record);
  const doi = record.identifiers?.doi ? ` doi:${record.identifiers.doi}.` : '';
  const pmid = record.identifiers?.pmid ? ` PMID:${record.identifiers.pmid}.` : '';
  const url = !doi && !pmid && record.url ? ` Available from: ${record.url}` : '';
  return `${vancouverAuthors(record)}. ${record.title}.${year ? ` ${year}.` : ''} ${SOURCE_LABELS[record.source]}.${doi}${pmid}${url}${pageSuffix(record)}`
    .replace(/\s+/g, ' ')
    .trim();
}

// ── APA 7th ───────────────────────────────────────────────────────────────

/** "Smith, J. A., & Doe, B." with up to 20 authors then an ellipsis. */
function apaAuthors(record: EvidenceItem): string {
  const names = record.authors.map((a) => a.trim()).filter(Boolean);
  if (names.length === 0) return SOURCE_LABELS[record.source];
  const formatted = names.slice(0, 20).map((n) => {
    const p = parseName(n);
    return p.initials ? `${p.family}, ${p.initials}` : p.family;
  });
  if (names.length === 1) return formatted[0]!;
  if (names.length > 20) return `${formatted.join(', ')}, … ${formatted.at(-1)!}`;
  return `${formatted.slice(0, -1).join(', ')}, & ${formatted.at(-1)!}`;
}

function apa(record: EvidenceItem): string {
  const year = yearText(record);
  return `${apaAuthors(record)} (${year ?? 'n.d.'}). ${record.title}. ${SOURCE_LABELS[record.source]}.${trailingId(record)}${pageSuffix(record)}`
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Harvard (author–date) ─────────────────────────────────────────────────

/** "Smith, J.A. and Doe, B." */
function harvardAuthors(record: EvidenceItem): string {
  const names = record.authors.map((a) => a.trim()).filter(Boolean);
  if (names.length === 0) return SOURCE_LABELS[record.source];
  const formatted = names.slice(0, 10).map((n) => {
    const p = parseName(n);
    return p.initials ? `${p.family}, ${p.initials}` : p.family;
  });
  if (names.length > 10) return `${formatted.join(', ')} et al.`;
  if (formatted.length === 1) return formatted[0]!;
  return `${formatted.slice(0, -1).join(', ')} and ${formatted.at(-1)!}`;
}

function harvard(record: EvidenceItem): string {
  const year = yearText(record);
  const avail = record.identifiers?.doi
    ? ` Available at: https://doi.org/${record.identifiers.doi}.`
    : record.url
      ? ` Available at: ${record.url}.`
      : record.identifiers?.pmid
        ? ` PMID: ${record.identifiers.pmid}.`
        : '';
  return `${harvardAuthors(record)} ${year ? `(${year})` : '(n.d.)'} '${record.title}', ${SOURCE_LABELS[record.source]}.${avail}${pageSuffix(record)}`
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Render one reference-list line for a record in the chosen style. The leading
 * number/marker is added by the caller — this returns only the formatted text.
 */
export function formatReference(record: EvidenceItem, style: CitationStyle): string {
  switch (style) {
    case 'apa':
      return apa(record);
    case 'harvard':
      return harvard(record);
    default:
      return vancouver(record);
  }
}
