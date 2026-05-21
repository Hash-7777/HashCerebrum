// Renders a chat message into a clean, publishable research-paper PDF:
// A4, Times typography, a centred title block, justified body text,
// section headings, a references list, and page numbers. jsPDF is loaded
// on demand so it never weighs down the main bundle.

import type { EvidenceItem } from '@platform/index';

export interface PaperPdfInput {
  title: string;
  content: string;
  modelLabel?: string;
  citations?: EvidenceItem[];
}

type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'numbered'; marker: string; text: string };

// Markdown → ordered blocks. Loose paragraphs are joined; headings, bullet
// lists, and numbered lists become their own blocks.
function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'p', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
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
  flush();
  return blocks;
}

// Drop emphasis markers we do not render inline.
function plain(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Loose comparison key so a leading heading that just repeats the title
// can be detected and skipped.
function normalizeHeading(text: string): string {
  return plain(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function formatReference(record: EvidenceItem, index: number): string {
  const year = record.year ? ` (${record.year})` : '';
  const id = record.identifiers?.pmid
    ? ` PMID: ${record.identifiers.pmid}`
    : record.identifiers?.doi
      ? ` DOI: ${record.identifiers.doi}`
      : '';
  return `[S${index + 1}] ${record.source.toUpperCase()}${year}. ${record.title}.${id}`;
}

export async function buildPaperPdfBlob(input: PaperPdfInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 64;
  const marginTop = 70;
  const marginBottom = 64;
  const contentW = pageW - marginX * 2;
  const bottomLimit = pageH - marginBottom;

  let y = marginTop;

  const ensureSpace = (need: number) => {
    if (y + need > bottomLimit) {
      doc.addPage();
      y = marginTop;
    }
  };

  // ---- Title block -------------------------------------------------------
  doc.setFont('times', 'bold');
  doc.setFontSize(21);
  doc.setTextColor(15, 23, 42);
  for (const line of doc.splitTextToSize(plain(input.title), contentW) as string[]) {
    ensureSpace(27);
    doc.text(line, pageW / 2, y, { align: 'center' });
    y += 27;
  }

  y += 3;
  doc.setFont('times', 'italic');
  doc.setFontSize(9.5);
  doc.setTextColor(110, 116, 130);
  const meta = `HashCerebrum${input.modelLabel ? ` · ${input.modelLabel}` : ''} · ${new Date().toLocaleDateString()}`;
  doc.text(meta, pageW / 2, y, { align: 'center' });
  y += 17;

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.8);
  doc.line(marginX, y, pageW - marginX, y);
  y += 22;

  // ---- Body --------------------------------------------------------------
  const heading = (text: string, level: 1 | 2 | 3) => {
    const size = level === 1 ? 14.5 : level === 2 ? 12.5 : 11;
    y += level === 3 ? 11 : 16;
    ensureSpace(size + 8);
    doc.setFont('times', 'bold');
    doc.setFontSize(size);
    doc.setTextColor(15, 23, 42);
    for (const line of doc.splitTextToSize(plain(text), contentW) as string[]) {
      ensureSpace(size + 4);
      doc.text(line, marginX, y);
      y += size + 4;
    }
    y += 4;
  };

  const BODY_SIZE = 10.5;
  const BODY_LEADING = 15;

  // A paragraph that begins with "**Label:**" keeps the label in bold; any
  // other paragraph is justified for a clean publishable column.
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
      const restLines = doc.splitTextToSize(plain(label[2] ?? ''), width - labelW) as string[];
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
    const lines = doc.splitTextToSize(plain(text), width) as string[];
    lines.forEach((line, i) => {
      ensureSpace(BODY_LEADING);
      const isLast = i === lines.length - 1;
      // Never justify a line dominated by one long unbreakable token (a URL
      // or DOI) — justification would stretch it into ugly letter-spacing.
      const longToken = line.split(/\s+/).some((token) => token.length > 38);
      if (!isLast && lines.length > 1 && !longToken) {
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
    const lines = doc.splitTextToSize(plain(text), width) as string[];
    lines.forEach((line, i) => {
      ensureSpace(BODY_LEADING);
      if (i === 0) doc.text(marker, marginX, y);
      doc.text(line, x, y);
      y += BODY_LEADING;
    });
    y += 3;
  };

  const blocks = parseBlocks(input.content);
  const titleKey = normalizeHeading(input.title);
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

  // ---- References — only the records actually cited in the body ----------
  // The swarm retrieves far more evidence than a paper cites; a real
  // reference list contains only the works the manuscript [S#]-cites.
  const citedNumbers = new Set<number>();
  for (const match of input.content.matchAll(/\[S(\d+)\]/g)) {
    citedNumbers.add(Number(match[1]));
  }
  const cited = [...citedNumbers].sort((a, b) => a - b);
  if (input.citations && input.citations.length > 0 && cited.length > 0) {
    heading('References', 2);
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(55, 65, 81);
    for (const number of cited) {
      const record = input.citations[number - 1];
      if (!record) continue;
      const lines = doc.splitTextToSize(formatReference(record, number - 1), contentW - 16) as string[];
      lines.forEach((line, li) => {
        ensureSpace(12);
        doc.text(line, marginX + (li === 0 ? 0 : 16), y);
        y += 12;
      });
      y += 3;
    }
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
