// Bibliography export — turn a paper's cited reference list into a BibTeX (.bib)
// or RIS (.ris) file so it can be imported into Mendeley, Zotero, EndNote, or any
// reference manager. Pure string builders (unit-tested) plus thin download
// helpers. Local-first: nothing leaves the device — the user just gets a file.

import type { EvidenceItem } from '@platform/index';
import { referenceUrl } from './citationStyles';
import { downloadTextFile, slugifyFilename } from '@platform/download';

// Literature databases whose records are journal articles; everything else
// (trials, drug labels, drug terminology, imported docs) exports as a generic
// entry so a manager does not mislabel a trial registration as a journal paper.
const ARTICLE_SOURCES = new Set<EvidenceItem['source']>([
  'pubmed',
  'europepmc',
  'openalex',
  'semantic_scholar',
]);

function isArticle(record: EvidenceItem): boolean {
  return ARTICLE_SOURCES.has(record.source);
}

function venue(record: EvidenceItem): string | null {
  const v =
    record.identifiers?.journal || record.identifiers?.venue || record.identifiers?.containerTitle;
  return v && v.trim() ? v.trim() : null;
}

function yearOf(record: EvidenceItem): string | null {
  if (record.year === null || record.year === undefined || record.year === '') return null;
  const n = typeof record.year === 'number' ? record.year : Number(record.year);
  return Number.isFinite(n) ? String(n) : String(record.year).trim() || null;
}

function doiOf(record: EvidenceItem): string | null {
  const doi = (record.identifiers?.doi ?? '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
  return doi || null;
}

function pmidOf(record: EvidenceItem): string | null {
  const pmid = (record.identifiers?.pmid ?? '').trim();
  return /^\d+$/.test(pmid) ? pmid : null;
}

/** Split a "123-130" / "123–130" page range into start / end. */
function pages(record: EvidenceItem): { start: string | null; end: string | null } {
  const raw = (record.pages ?? '').trim();
  if (!raw) return { start: null, end: null };
  const m = /^(\S+?)\s*[–—-]\s*(\S+)$/.exec(raw);
  if (m) return { start: m[1]!, end: m[2]! };
  return { start: raw, end: null };
}

// ── BibTeX ──────────────────────────────────────────────────────────────────

// Escape the characters that are special inside a BibTeX/LaTeX field value, so a
// title with an ampersand or percent cannot corrupt the entry.
function bibtexEscape(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\s+/g, ' ')
    .trim();
}

function surname(author: string): string {
  const name = author.trim().replace(/\s+/g, ' ');
  if (!name) return '';
  const comma = name.indexOf(',');
  if (comma > 0) return name.slice(0, comma).trim(); // "Smith, John A." → Smith
  const parts = name.split(' ');
  if (parts.length === 1) return parts[0]!;
  const last = parts.at(-1)!;
  // "Smith JA" / "Smith J" — a trailing initials token (all-caps, ≤3 letters,
  // or ending in a dot) means Vancouver order, so the FIRST token is the family
  // name. Otherwise ("John Smith") the last token is the family name.
  return /^[A-Z]{1,3}\.?$/.test(last) ? parts[0]! : last;
}

/** Deterministic ASCII citation key, disambiguated with a/b/c on collision. */
function citationKey(record: EvidenceItem, used: Set<string>): string {
  const base = (surname(record.authors[0] ?? '') || record.source)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
  const stem = `${base || 'ref'}${yearOf(record) ?? 'nd'}`;
  let key = stem;
  let suffix = 97; // 'a'
  while (used.has(key)) {
    key = `${stem}${String.fromCharCode(suffix)}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

function bibtexEntry(record: EvidenceItem, key: string): string {
  const fields: string[] = [];
  const push = (name: string, value: string | null | undefined) => {
    if (value && value.trim()) fields.push(`  ${name} = {${bibtexEscape(value)}}`);
  };
  if (record.authors.length > 0) {
    fields.push(`  author = {${record.authors.map((a) => bibtexEscape(a)).join(' and ')}}`);
  }
  // Double braces preserve the title's capitalisation in every manager.
  if (record.title?.trim()) fields.push(`  title = {{${bibtexEscape(record.title)}}}`);
  push(isArticle(record) ? 'journal' : 'howpublished', venue(record));
  push('year', yearOf(record));
  push('volume', record.volume);
  push('number', record.issue);
  // BibTeX page ranges use an en-dash written as "--"; collapse any run of
  // hyphens/dashes so "221-230" and "221–230" both become "221--230".
  push('pages', (record.pages ?? '').trim().replace(/\s*[-–—]+\s*/g, '--') || null);
  push('doi', doiOf(record));
  // `pmid` is non-standard but recognised by Mendeley / Zotero as an extra field.
  push('pmid', pmidOf(record));
  push('url', referenceUrl(record));
  const type = isArticle(record) ? 'article' : 'misc';
  return `@${type}{${key},\n${fields.join(',\n')},\n}`;
}

export function buildBibtex(citations: EvidenceItem[]): string {
  const used = new Set<string>();
  return `${citations.map((record) => bibtexEntry(record, citationKey(record, used))).join('\n\n')}\n`;
}

// ── RIS ───────────────────────────────────────────────────────────────────────

function risEntry(record: EvidenceItem): string {
  const lines: string[] = [];
  const tag = (name: string, value: string | null | undefined) => {
    if (value && String(value).trim()) lines.push(`${name}  - ${String(value).trim()}`);
  };
  lines.push(`TY  - ${isArticle(record) ? 'JOUR' : 'GEN'}`);
  for (const author of record.authors) if (author.trim()) lines.push(`AU  - ${author.trim()}`);
  tag('TI', record.title);
  tag('T2', venue(record));
  tag('PY', yearOf(record));
  tag('VL', record.volume);
  tag('IS', record.issue);
  const pg = pages(record);
  tag('SP', pg.start);
  tag('EP', pg.end);
  tag('DO', doiOf(record));
  tag('AN', pmidOf(record)); // accession number = PMID
  tag('UR', referenceUrl(record));
  lines.push('ER  - ');
  return lines.join('\n');
}

export function buildRis(citations: EvidenceItem[]): string {
  return `${citations.map(risEntry).join('\n\n')}\n`;
}

// ── Download helpers ──────────────────────────────────────────────────────────

export function exportReferencesBibtex(title: string, citations: EvidenceItem[] = []): void {
  if (citations.length === 0) return;
  downloadTextFile(
    `${slugifyFilename(title)}-references.bib`,
    buildBibtex(citations),
    'application/x-bibtex;charset=utf-8',
  );
}

export function exportReferencesRis(title: string, citations: EvidenceItem[] = []): void {
  if (citations.length === 0) return;
  downloadTextFile(
    `${slugifyFilename(title)}-references.ris`,
    buildRis(citations),
    'application/x-research-info-systems;charset=utf-8',
  );
}
