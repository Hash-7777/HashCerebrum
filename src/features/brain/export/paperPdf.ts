// Renders a chat message into a clean, publishable research-paper PDF:
// A4, Times typography, a centred title block, readable body text,
// section headings, a references list, and page numbers. jsPDF is loaded
// on demand so it never weighs down the main bundle.

import type { EvidenceItem } from '@platform/index';
import type { Manuscript } from '../swarm/manuscript';

export interface PaperPdfInput {
  title: string;
  content: string;
  modelLabel?: string;
  citations?: EvidenceItem[];
  // When present, the PDF is rendered deterministically from this structure
  // instead of by parsing the markdown in `content`.
  manuscript?: Manuscript;
}

export type PaperPdfBlock =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'numbered'; marker: string; text: string };

function isTableSeparator(line: string): boolean {
  return /^[\s|:\-]+$/.test(line) && line.includes('-');
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function tableRowsToBullets(rows: string[]): string[] {
  const parsed = rows.filter((line) => !isTableSeparator(line)).map(tableCells).filter((cells) => cells.length > 1);
  if (parsed.length === 0) return [];
  const hasHeader = parsed.length > 1;
  const header = parsed[0]!;
  const dataRows = hasHeader ? parsed.slice(1) : parsed;

  return dataRows.map((cells) => {
    const text =
      hasHeader && header.length === cells.length
        ? cells.map((cell, index) => `${header[index]}: ${cell}`).join('; ')
        : cells.join('; ');
    return plain(text);
  });
}

// Markdown → ordered blocks. Loose paragraphs are joined; headings, bullet
// lists, numbered lists, and markdown tables become their own blocks.
export function parseBlocks(markdown: string): PaperPdfBlock[] {
  const blocks: PaperPdfBlock[] = [];
  let paragraph: string[] = [];
  let table: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'p', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };
  const flushTable = () => {
    if (!table.length) return;
    flush();
    for (const row of tableRowsToBullets(table)) {
      blocks.push({ kind: 'bullet', text: row });
    }
    table = [];
  };
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const isTableRow = line.includes('|') && tableCells(line).length > 1;
    if (!line) {
      flushTable();
      flush();
      continue;
    }
    if (isTableRow || (table.length > 0 && isTableSeparator(line))) {
      flush();
      table.push(line);
      continue;
    }
    flushTable();
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      blocks.push({ kind: level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3', text: heading[2]!.trim() });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flush();
      blocks.push({ kind: 'bullet', text: bullet[1]!.trim() });
      continue;
    }
    const numbered = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      flush();
      blocks.push({ kind: 'numbered', marker: `${numbered[1]}.`, text: numbered[2]!.trim() });
      continue;
    }
    // A line that is nothing but a bold phrase is a section heading the
    // model wrote as "**Heading**" instead of "## Heading".
    const boldHeading = line.match(/^\*\*([^*]+?)\*\*:?\s*$/);
    if (boldHeading) {
      flush();
      blocks.push({ kind: 'h2', text: boldHeading[1]!.trim() });
      continue;
    }
    paragraph.push(line);
  }
  flushTable();
  flush();
  return blocks;
}

// Drop emphasis markers we do not render inline, and neutralize raw table
// delimiters from old exports before they can stretch PDF text.
function plain(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]*\|[ \t]*/g, '; ')
    .replace(/-{4,}/g, ' ')
    .replace(/\s+([;,.])/g, '$1')
    .replace(/;\s*;/g, ';')
    .replace(/\s+/g, ' ')
    .trim();
}

// Loose comparison key so a leading heading that just repeats the title
// can be detected and skipped.
function normalizeHeading(text: string): string {
  return plain(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

interface PdfTextWrapper {
  getTextWidth(text: string): number;
  splitTextToSize(text: string, width: number): string | string[];
}

function breakLongPdfToken(doc: PdfTextWrapper, token: string, width: number): string[] {
  if (doc.getTextWidth(token) <= width) return [token];

  const chunks: string[] = [];
  let current = '';
  const limit = Math.max(16, width * 0.96);
  for (const char of token) {
    const candidate = `${current}${char}`;
    if (current && doc.getTextWidth(candidate) > limit) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function reflowPdfLine(doc: PdfTextWrapper, line: string, width: number): string[] {
  const words = line.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    for (const piece of breakLongPdfToken(doc, word, width)) {
      const candidate = current ? `${current} ${piece}` : piece;
      if (current && doc.getTextWidth(candidate) > width) {
        lines.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export function splitPdfTextToSize(doc: PdfTextWrapper, text: string, width: number): string[] {
  const rawLines = doc.splitTextToSize(text, width);
  const baseLines = Array.isArray(rawLines) ? rawLines : [rawLines];
  return baseLines.flatMap((line) => reflowPdfLine(doc, String(line), width));
}

function formatReference(record: EvidenceItem, index: number, _style: 'source' | 'vancouver' = 'source'): string {
  const year = record.year ? ` (${record.year})` : '';
  const id = record.identifiers?.pmid
    ? ` PMID: ${record.identifiers.pmid}.`
    : record.identifiers?.doi
      ? ` doi: ${record.identifiers.doi}.`
      : '';
  const authors =
    record.authors.length > 0
      ? record.authors.slice(0, 4).join(', ') + (record.authors.length > 4 ? ' et al.' : '') + '.'
      : record.source.toUpperCase() + '.';
  // The leading "[n]" marker is drawn separately in accent colour; we only
  // return the body text here (marker is NOT prepended to avoid duplication).
  return `[${index + 1}] ${authors} ${record.title}.${year} ${record.source.toUpperCase()}.${id}`;
}

// Accent mint colour (#82e0c2) used across headings and decorative elements.
const ACCENT_R = 130;
const ACCENT_G = 224;
const ACCENT_B = 194;

export async function buildPaperPdfBlob(input: PaperPdfInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 60;
  const marginTop = 76;
  const marginBottom = 60;
  const contentW = pageW - marginX * 2;
  const bottomLimit = pageH - marginBottom;

  let y = marginTop;

  const ensureSpace = (need: number) => {
    if (y + need > bottomLimit) {
      doc.addPage();
      // Accent bar on each new page
      doc.setFillColor(ACCENT_R, ACCENT_G, ACCENT_B);
      doc.rect(0, 0, pageW, 3, 'F');
      y = marginTop;
    }
  };

  // ---- Accent bar (top of first page) ------------------------------------
  doc.setFillColor(ACCENT_R, ACCENT_G, ACCENT_B);
  doc.rect(0, 0, pageW, 4, 'F');

  // ---- Title block -------------------------------------------------------
  const documentTitle = plain(input.manuscript?.title ?? input.title) || 'HashCerebrum Research Manuscript';
  doc.setFont('times', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(12, 22, 37);
  for (const line of splitPdfTextToSize(doc, documentTitle, contentW)) {
    ensureSpace(28);
    doc.text(line, pageW / 2, y, { align: 'center' });
    y += 28;
  }

  y += 5;
  doc.setFont('times', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(135, 155, 180);
  const meta = `HashCerebrum${input.modelLabel ? ` · ${input.modelLabel}` : ''} · ${new Date().toLocaleDateString()}`;
  doc.text(meta.toUpperCase(), pageW / 2, y, { align: 'center' });
  y += 6;

  // Thin accent rule below meta
  doc.setFillColor(ACCENT_R, ACCENT_G, ACCENT_B);
  doc.rect(marginX + contentW * 0.3, y + 4, contentW * 0.4, 1.5, 'F');
  y += 22;

  // ---- Body --------------------------------------------------------------
  const heading = (text: string, level: 1 | 2 | 3) => {
    const size = level === 1 ? 15 : level === 2 ? 12.5 : 11;
    y += level === 3 ? 13 : 20;
    ensureSpace(size + 12);
    doc.setFont('times', 'bold');
    doc.setFontSize(size);
    doc.setTextColor(12, 22, 37);
    for (const line of splitPdfTextToSize(doc, plain(text), contentW)) {
      ensureSpace(size + 4);
      doc.text(line, marginX, y);
      y += size + 5;
    }
    if (level === 2) {
      // Subtle separator rule under every H2
      doc.setDrawColor(220, 230, 242);
      doc.setLineWidth(0.5);
      doc.line(marginX, y + 1, pageW - marginX, y + 1);
      y += 7;
    } else {
      y += 3;
    }
  };

  const BODY_SIZE = 10.5;
  const BODY_LEADING = 15;

  // A paragraph that begins with "**Label:**" keeps the label in bold. Other
  // paragraphs use conservative justification only when the line is safe;
  // raw table fragments and long identifiers are kept ragged-right.
  const paragraph = (text: string, indent = 0) => {
    const width = contentW - indent;
    const x = marginX + indent;
    doc.setFontSize(BODY_SIZE);
    doc.setTextColor(31, 41, 55);

    const label = text.match(/^\*\*([^*]+?)\*\*:?\s*([\s\S]*)$/);
    if (label) {
      const labelText = `${label[1]!.trim()}:  `;
      doc.setFont('times', 'bold');
      const labelW = doc.getTextWidth(labelText);
      doc.setFont('times', 'normal');
      const restLines = splitPdfTextToSize(doc, plain(label[2] ?? ''), Math.max(40, width - labelW));
      ensureSpace(BODY_LEADING);
      doc.setFont('times', 'bold');
      doc.text(labelText, x, y);
      doc.setFont('times', 'normal');
      restLines.forEach((line, i) => {
        if (i > 0) {
          y += BODY_LEADING;
          ensureSpace(BODY_LEADING);
        }
        doc.text(line, i === 0 ? x + labelW : x, y);
      });
      y += BODY_LEADING + 7;
      return;
    }

    doc.setFont('times', 'normal');
    const cleaned = plain(text);
    const unsafeForJustify = /[|]/.test(text) || /-{4,}/.test(text) || /;\s*\w+:/i.test(cleaned);
    const lines = splitPdfTextToSize(doc, cleaned, width);
    lines.forEach((line, i) => {
      ensureSpace(BODY_LEADING);
      const isLast = i === lines.length - 1;
      // Never justify a line dominated by one long unbreakable token (a URL
      // or DOI) — justification would stretch it into ugly letter-spacing.
      const longToken = line.split(/\s+/).some((token) => token.length > 38);
      const enoughWords = line.split(/\s+/).filter(Boolean).length >= 8;
      if (!isLast && lines.length > 1 && !longToken && !unsafeForJustify && enoughWords) {
        doc.text(line, x, y, { align: 'justify', maxWidth: width });
      } else {
        doc.text(line, x, y);
      }
      y += BODY_LEADING;
    });
    y += 7;
  };

  const listItem = (marker: string, text: string) => {
    const indent = 16;
    const x = marginX + indent;
    const width = contentW - indent;
    doc.setFont('times', 'normal');
    doc.setFontSize(BODY_SIZE);
    doc.setTextColor(31, 41, 55);
    const lines = splitPdfTextToSize(doc, plain(text), width);
    lines.forEach((line, i) => {
      ensureSpace(BODY_LEADING);
      if (i === 0) doc.text(marker, marginX, y);
      doc.text(line, x, y);
      y += BODY_LEADING;
    });
    y += 3;
  };

  // Deterministic render straight from the structured manuscript — the
  // reliable path. Falls back to markdown parsing for non-paper messages.
  const renderManuscript = (m: Manuscript) => {
    heading('Abstract', 2);
    const absField = (label: string, text: string) => {
      if (text.trim()) paragraph(`**${label}:** ${text}`);
    };
    absField('Background', m.abstract.background);
    absField('Objective', m.abstract.objective);
    absField('Methods', m.abstract.methods);
    absField('Results', m.abstract.results);
    absField('Conclusions', m.abstract.conclusions);
    if (m.keywords.length > 0) paragraph(`**Keywords:** ${m.keywords.join(', ')}`);
    for (const section of m.sections) {
      heading(section.heading, 2);
      for (const para of section.body) paragraph(para);
    }
  };

  if (input.manuscript) {
    renderManuscript(input.manuscript);
  } else {
    const blocks = parseBlocks(input.content);
    const titleKey = normalizeHeading(documentTitle);
    blocks.forEach((block, index) => {
      // The title is already rendered as the document title — skip a leading
      // heading that merely repeats it.
      if (
        index === 0 &&
        (block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3') &&
        normalizeHeading(block.text) === titleKey
      ) {
        return;
      }
      if (block.kind === 'h1' || block.kind === 'h2') heading(block.text, 2);
      else if (block.kind === 'h3') heading(block.text, 3);
      else if (block.kind === 'bullet') listItem('•', block.text);
      else if (block.kind === 'numbered') listItem(block.marker, block.text);
      else paragraph(block.text);
    });
  }

  // ---- References --------------------------------------------------------
  // Prefer citing only records that appear as [S1] / [1] inline markers.
  // If the body has no inline markers (e.g. plain AI chat response), fall
  // back to listing every attached citation record in source order.
  if (input.citations && input.citations.length > 0) {
    const citedNumbers = new Set<number>();
    const markerStyle = input.manuscript?.publication ? 'vancouver' : 'source';
    for (const match of input.content.matchAll(/\[(?:S)?(\d+)\]/g)) {
      citedNumbers.add(Number(match[1]));
    }
    // Fallback: no inline markers found → show all citations sequentially.
    const cited =
      citedNumbers.size > 0
        ? [...citedNumbers].sort((a, b) => a - b)
        : input.citations.map((_, i) => i + 1);

    heading('References', 2);
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 80, 100);
    cited.forEach((number, listIndex) => {
      const record = input.citations![number - 1];
      if (!record) return;
      const refText = formatReference(record, listIndex, markerStyle);
      const lines = splitPdfTextToSize(doc, refText, contentW - 22);
      // Accent-coloured bracket marker on first line
      lines.forEach((line, li) => {
        ensureSpace(13);
        if (li === 0) {
          // Draw the [n] marker in accent colour
          const markerStr = `[${listIndex + 1}]`;
          doc.setTextColor(ACCENT_R, ACCENT_G, ACCENT_B);
          doc.setFont('times', 'bold');
          doc.text(markerStr, marginX, y);
          const markerW = doc.getTextWidth(markerStr) + 4;
          doc.setTextColor(60, 80, 100);
          doc.setFont('times', 'normal');
          // Strip the leading marker from the line jsPDF already has
          const bodyLine = line.replace(/^\[\d+\]\s*/, '');
          doc.text(bodyLine, marginX + markerW, y);
        } else {
          doc.text(line, marginX + 22, y);
        }
        y += 13;
      });
      y += 4;
    });
  }

  // ---- Page numbers ------------------------------------------------------
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont('times', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(140, 146, 158);
    doc.text(`${page} / ${pages}`, pageW / 2, pageH - 34, { align: 'center' });
  }

  return doc.output('blob');
}
