// The paper's reference list: which retrieved records the manuscript cites, in
// order of first citation, as canonical references with CSL data behind them,
// and their display text in any supported citation style.
//
// A reference is built only from a record the pipeline retrieved, never from
// drafted text, and an untitled record is left out rather than rendered as a
// bare, unverifiable entry. The same record reached through two sources is
// merged into one reference by identifier or by normalised title and year.

import type { EvidenceItem } from '@platform/index';
import { evidenceIdentity, normalizeText, stableHash } from './textNormalize';
import type { Manuscript } from './manuscript';
import type { CanonicalReference, CitationMapEntry, CslReference } from './publicationTypes';
import { expandCitationMarkers } from './citationMarkers';
import { formatReference, referenceUrl, type CitationStyle } from '../export/citationStyles';

// Resolve a reference's display text in the requested style. Vancouver (or no
// style) returns the text baked at build time verbatim — zero regression — and
// other styles are re-rendered from the underlying evidence record on demand.
export function referenceText(reference: CanonicalReference, style?: CitationStyle): string {
  if (!style || style === 'vancouver') return reference.text;
  return formatReference(reference.evidence, style);
}

// Escape the two characters that would break a Markdown link label, so a
// reference title containing brackets cannot corrupt the [label](url) wrapper.
function escapeMdLinkLabel(text: string): string {
  return text.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

// A reference-list line as Markdown: the whole line links to the real paper
// (DOI → PubMed → …) when a URL is resolvable, otherwise plain text.
export function referenceMarkdownLine(reference: CanonicalReference, style?: CitationStyle): string {
  const text = referenceText(reference, style);
  const url = referenceUrl(reference.evidence);
  const body = url ? `[${escapeMdLinkLabel(text)}](${url})` : text;
  return `${reference.displayMarker} ${body}`;
}

export const SOURCE_CITATION_RX = /\[(?:S)?(\d+)\]/g;

function sourceMarker(index: number): string {
  return `S${index + 1}`;
}

function textFromManuscript(manuscript: Manuscript): string {
  return [
    manuscript.title,
    manuscript.abstract.background,
    manuscript.abstract.objective,
    manuscript.abstract.methods,
    manuscript.abstract.results,
    manuscript.abstract.conclusions,
    ...manuscript.sections.flatMap((section) => [section.heading, ...section.body]),
  ].join('\n\n');
}

export function citedSourceNumbers(manuscript: Manuscript): number[] {
  const seen = new Set<number>();
  // Expand grouped / ranged markers first so a record cited only inside
  // "[S25, S27]" is still recognised as cited and kept in the reference list.
  const text = expandCitationMarkers(textFromManuscript(manuscript), 200);
  for (const match of text.matchAll(SOURCE_CITATION_RX)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) seen.add(value);
  }
  return [...seen].sort((a, b) => a - b);
}

function cslType(record: EvidenceItem): CslReference['type'] {
  if (record.source === 'ctgov') return 'clinical-trial';
  if (record.source === 'openfda' || record.source === 'rxnorm') return 'report';
  if (record.url && !record.identifiers?.doi && !record.identifiers?.pmid) return 'webpage';
  return 'article-journal';
}

function cslAuthors(authors: string[]): { family: string; given?: string }[] | undefined {
  const parsed = authors
    .map((author) => author.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((author) => {
      const parts = author.split(/\s+/);
      if (parts.length <= 1) return { family: author };
      return { family: parts.at(-1)!, given: parts.slice(0, -1).join(' ') };
    });
  return parsed.length > 0 ? parsed : undefined;
}

function cslReference(record: EvidenceItem, id: string): CslReference {
  const year = typeof record.year === 'number' ? record.year : Number(record.year);
  const authors = cslAuthors(record.authors);
  return {
    id,
    type: cslType(record),
    title: record.title,
    ...(authors ? { author: authors } : {}),
    ...(Number.isFinite(year) ? { issued: { 'date-parts': [[year]] } } : {}),
    ...(record.identifiers?.doi ? { DOI: record.identifiers.doi } : {}),
    ...(record.identifiers?.pmid ? { PMID: record.identifiers.pmid } : {}),
    ...(record.url ? { URL: record.url } : {}),
    source: record.source,
  };
}

export function canonicalReferences(manuscript: Manuscript, evidence: EvidenceItem[]) {
  const cited = citedSourceNumbers(manuscript);
  const byIdentity = new Map<string, CanonicalReference>();
  const byTitleYear = new Map<string, CanonicalReference>();
  const references: CanonicalReference[] = [];
  const citationMap: Record<string, CitationMapEntry> = {};

  for (const number of cited) {
    const evidenceIndex = number - 1;
    const record = evidence[evidenceIndex];
    if (!record) continue;
    // An untitled record is not a verifiable citation — it renders as a bare
    // ". pubmed." reference. Skip it so it never enters the reference list; its
    // marker then resolves to nothing and is dropped from the body by
    // replaceCitations, keeping the numbering sequential and honest.
    if (!record.title || !record.title.trim()) continue;

    const identity = evidenceIdentity(record);
    let reference = byIdentity.get(identity);

    // I5: cross-source fuzzy dedup — if primary identifiers differ but
    // normalized title+year match, merge into the same reference.
    if (!reference) {
      const titleYearKey = `title:${normalizeText(record.title).toLowerCase()}-${record.year ?? ''}`;
      reference = byTitleYear.get(titleYearKey);
      if (reference) {
        byIdentity.set(identity, reference);
      }
    }

    if (!reference) {
      const vancouverNumber = references.length + 1;
      const id = `ref-${stableHash(identity)}`;
      reference = {
        id,
        sourceMarker: `[S${number}]`,
        displayMarker: `[${vancouverNumber}]`,
        vancouverNumber,
        evidenceIndex,
        evidence: record,
        csl: cslReference(record, id),
        text: formatReference(record, 'vancouver'),
      };
      byIdentity.set(identity, reference);
      const titleYearKey = `title:${normalizeText(record.title).toLowerCase()}-${record.year ?? ''}`;
      byTitleYear.set(titleYearKey, reference);
      references.push(reference);
    }

    const marker = sourceMarker(evidenceIndex);
    citationMap[marker] = {
      sourceMarker: `[${marker}]`,
      displayMarker: reference.displayMarker,
      referenceId: reference.id,
      evidenceIndex,
    };
  }

  return { references, citationMap };
}
