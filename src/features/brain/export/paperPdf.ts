// Renders a chat message into a clean, publishable research-paper PDF:
// A4, Times typography, a centred title block, readable body text,
// section headings, a references list, and page numbers. jsPDF is loaded
// on demand so it never weighs down the main bundle.

import type { EvidenceItem } from '@platform/index';
import { formatReference } from './citationStyles';
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
    // Horizontal rule (--- / *** / ___) — skip, PDF doesn't render <hr>.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
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
  flushTable();
  flush();
  return blocks;
}

// Convert common LaTeX inline math spans to readable Unicode for PDF output.
function latexToUnicode(text: string): string {
  const greek: Record<string, string> = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ',
    nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
    phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ',
    Lambda: 'Λ', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
  };
  const sub = '₀₁₂₃₄₅₆₇₈₉';
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return text
    .replace(/\$\\([A-Za-z]+)_(\d)\$/g, (_, name: string, n: string) =>
      (greek[name] ?? name) + (sub[Number(n)] ?? n))
    .replace(/\$\\([A-Za-z]+)\$/g, (_, name: string) => greek[name] ?? name)
    .replace(/\$(\w)\^(\d)\$/g, (_, base: string, n: string) =>
      base + (sup[Number(n)] ?? n))
    .replace(/\$\\pm\$/g, '±')
    .replace(/\$\\geq?\$/g, '≥')
    .replace(/\$\\leq?\$/g, '≤')
    .replace(/\$\\times\$/g, '×')
    .replace(/\$\\neq?\$/g, '≠')
    .replace(/\$\\approx\$/g, '≈')
    .replace(/\$\\infty\$/g, '∞')
    .replace(/\$([^$]{1,80})\$/g, (_, inner: string) =>
      inner.replace(/\\[a-zA-Z]+/g, '').replace(/[{}^_]/g, ''));
}

// jsPDF's built-in "times" font can only draw the WinAnsi / Latin-1 character
// set. Characters outside it — Greek letters, math relations, arrows,
// sub/superscripts — render as broken glyphs ("weird fonts"). When a Unicode
// font is embedded (see embedUnicodeFont) this flag is flipped to true and the
// transliteration below is skipped because the embedded font can draw them.
let pdfFontHasUnicode = false;

export function setPdfFontHasUnicode(value: boolean): void {
  pdfFontHasUnicode = value;
}

// Transliteration of common non-WinAnsi characters to safe ASCII. Latin-1
// characters that the built-in font already supports (± × ÷ µ ° ¼ ½ ¾,
// accented letters) are intentionally absent so they pass through unchanged.
const UNICODE_TO_ASCII: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta',
  η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu',
  ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma', ς: 'sigma', τ: 'tau', υ: 'upsilon',
  φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Α: 'Alpha', Β: 'Beta', Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda',
  Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega',
  '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '≅': '~=', '≡': '=', '∝': '~',
  '∼': '~', '−': '-', '∞': 'inf', '√': 'sqrt', '∑': 'sum', '∏': 'prod',
  '∫': 'integral', '∂': 'd', '∇': 'grad', '⋅': '*', '∙': '*',
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '⇔': '<=>',
  '↑': 'up', '↓': 'down',
  '′': "'", '″': '"', '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"',
  '„': '"', '–': '-', '—': '-', '―': '-', '‐': '-', '‑': '-', '…': '...',
  '•': '-', '™': '(TM)', '®': '(R)', '©': '(C)',
  '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4', '⁵': '^5', '⁶': '^6',
  '⁷': '^7', '⁸': '^8', '⁹': '^9', ⁿ: '^n', '⁺': '^+', '⁻': '^-',
  '₀': '_0', '₁': '_1', '₂': '_2', '₃': '_3', '₄': '_4', '₅': '_5', '₆': '_6',
  '₇': '_7', '₈': '_8', '₉': '_9',
};

// Make any string safe to draw with the active PDF font: strip zero-width
// characters, normalize NBSP, and — unless a Unicode font is embedded —
// transliterate every non-Latin-1 character to a readable ASCII equivalent,
// decomposing accented forms and dropping anything otherwise unrenderable.
export function winAnsiSafe(text: string): string {
  const base = text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\u00A0/g, ' ');
  if (pdfFontHasUnicode) return base;
  let out = '';
  for (const ch of base) {
    const mapped = UNICODE_TO_ASCII[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    if ((ch.codePointAt(0) ?? 0) <= 0xff) {
      out += ch;
      continue;
    }
    // Reach an ASCII/Latin-1 base via compatibility decomposition (ā → a);
    // characters that still fall outside the set are silently dropped.
    for (const piece of ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')) {
      if ((piece.codePointAt(0) ?? 0) <= 0xff) out += piece;
    }
  }
  return out;
}

// Drop emphasis markers we do not render inline, neutralize raw table
// delimiters, convert LaTeX spans to Unicode, and finally make the result
// safe for the active PDF font.
function plain(text: string): string {
  return winAnsiSafe(
    latexToUnicode(text)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[ \t]*\|[ \t]*/g, '; ')
      .replace(/-{4,}/g, ' ')
      .replace(/\s+([;,.])/g, '$1')
      .replace(/;\s*;/g, ';')
      .replace(/\s+/g, ' ')
      .trim(),
  );
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

function formatReferenceIndexed(record: EvidenceItem, index: number): string {
  // Delegate to the single source of truth in citationStyles.ts, then prepend
  // the numbered bracket marker used by the PDF renderer.
  return `[${index + 1}] ${formatReference(record, 'vancouver')}`;
}

// Accent mint colour (#82e0c2) used across headings and decorative elements.
const ACCENT_R = 130;
const ACCENT_G = 224;
const ACCENT_B = 194;

// Embedded Unicode serif (DejaVu Serif, Bitstream Vera licence). Covers Latin,
// Greek, and the common math/relation/arrow glyphs the built-in WinAnsi
// "times" font cannot draw. Lazily fetched from /public on first export and
// cached as base64 for the lifetime of the page.
const EMBED_FONT = 'DejaVuSerif';
const FONT_FILES = {
  normal: { vfs: 'DejaVuSerif.ttf', url: '/fonts/DejaVuSerif.ttf' },
  bold: { vfs: 'DejaVuSerif-Bold.ttf', url: '/fonts/DejaVuSerif-Bold.ttf' },
} as const;
const fontBase64Cache = new Map<string, string>();

async function fetchFontBase64(url: string): Promise<string> {
  const cached = fontBase64Cache.get(url);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`font fetch failed (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    fontBase64Cache.set(url, base64);
    return base64;
  } finally {
    clearTimeout(timer);
  }
}

// Register the embedded Unicode font on the document. Returns true on success;
// on any failure (asset missing, fetch blocked) the caller stays on the
// built-in font and the WinAnsi sanitizer handles non-Latin-1 characters.
async function embedUnicodeFont(doc: {
  addFileToVFS: (name: string, data: string) => void;
  addFont: (file: string, family: string, style: string) => void;
}): Promise<boolean> {
  try {
    const [normal, bold] = await Promise.all([
      fetchFontBase64(FONT_FILES.normal.url),
      fetchFontBase64(FONT_FILES.bold.url),
    ]);
    doc.addFileToVFS(FONT_FILES.normal.vfs, normal);
    doc.addFont(FONT_FILES.normal.vfs, EMBED_FONT, 'normal');
    doc.addFileToVFS(FONT_FILES.bold.vfs, bold);
    doc.addFont(FONT_FILES.bold.vfs, EMBED_FONT, 'bold');
    return true;
  } catch {
    return false;
  }
}

export async function buildPaperPdfBlob(input: PaperPdfInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  // Embed the Unicode serif if available; otherwise fall back to the built-in
  // "times" font and let the WinAnsi sanitizer transliterate. setPdfFontHasUnicode
  // tells plain()/winAnsiSafe() whether the active font can draw Greek + math.
  const unicodeFontReady = await embedUnicodeFont(doc);
  setPdfFontHasUnicode(unicodeFontReady);
  const FONT = unicodeFontReady ? EMBED_FONT : 'times';

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
  // Title — centred bold, sized to match the Typst manuscript (19pt) so the
  // jsPDF and Typst renderers produce a visually consistent paper.
  doc.setFont(FONT, 'bold');
  doc.setFontSize(19);
  doc.setTextColor(15, 27, 45); // #0f1b2d, the Typst level-1 heading colour
  for (const line of splitPdfTextToSize(doc, documentTitle, contentW)) {
    ensureSpace(24);
    doc.text(line, pageW / 2, y, { align: 'center' });
    y += 24;
  }

  // Byline — centred, muted, normal case (matches Typst's italic byline tone).
  y += 6;
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 116, 128); // #6e7480
  const meta = winAnsiSafe(`HashCerebrum${input.modelLabel ? ` · ${input.modelLabel}` : ''} · ${new Date().toLocaleDateString()}`);
  doc.text(meta, pageW / 2, y, { align: 'center' });
  y += 12;

  // Full-width hairline rule under the title block, like the Typst paper.
  doc.setDrawColor(203, 213, 225); // #cbd5e1
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageW - marginX, y);
  y += 20;

  // ---- Body --------------------------------------------------------------
  const heading = (text: string, level: 1 | 2 | 3) => {
    // Heading sizes matched to the Typst manuscript (level-1 13pt, level-2 ~10.5pt).
    const size = level === 1 ? 13 : level === 2 ? 11.5 : 10.5;
    y += level === 3 ? 13 : 20;
    ensureSpace(size + 12);
    doc.setFont(FONT, 'bold');
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
      doc.setFont(FONT, 'bold');
      const labelW = doc.getTextWidth(labelText);
      doc.setFont(FONT, 'normal');
      const restLines = splitPdfTextToSize(doc, plain(label[2] ?? ''), Math.max(40, width - labelW));
      ensureSpace(BODY_LEADING);
      doc.setFont(FONT, 'bold');
      doc.text(labelText, x, y);
      doc.setFont(FONT, 'normal');
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

    doc.setFont(FONT, 'normal');
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
    doc.setFont(FONT, 'normal');
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
    for (const match of input.content.matchAll(/\[(?:S)?(\d+)\]/g)) {
      citedNumbers.add(Number(match[1]));
    }
    // Fallback: no inline markers found → show all citations sequentially.
    const cited =
      citedNumbers.size > 0
        ? [...citedNumbers].sort((a, b) => a - b)
        : input.citations.map((_, i) => i + 1);

    heading('References', 2);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 80, 100);
    cited.forEach((number, listIndex) => {
      const record = input.citations![number - 1];
      if (!record) return;
      const refText = winAnsiSafe(formatReferenceIndexed(record, listIndex));
      const lines = splitPdfTextToSize(doc, refText, contentW - 22);
      // Accent-coloured bracket marker on first line
      lines.forEach((line, li) => {
        ensureSpace(13);
        if (li === 0) {
          // Draw the [n] marker in accent colour
          const markerStr = `[${listIndex + 1}]`;
          doc.setTextColor(ACCENT_R, ACCENT_G, ACCENT_B);
          doc.setFont(FONT, 'bold');
          doc.text(markerStr, marginX, y);
          const markerW = doc.getTextWidth(markerStr) + 4;
          doc.setTextColor(60, 80, 100);
          doc.setFont(FONT, 'normal');
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

  // ---- Running header + page numbers -------------------------------------
  // A muted, right-aligned short title in the top margin (from page 2) plus a
  // centred "n / total" footer — the journal-style framing the Typst paper uses.
  const pages = doc.getNumberOfPages();
  const shortTitle = winAnsiSafe(documentTitle.length > 64 ? `${documentTitle.slice(0, 63).trimEnd()}…` : documentTitle);
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont(FONT, 'normal');
    if (page > 1) {
      doc.setFontSize(8);
      doc.setTextColor(154, 163, 178); // #9aa3b2
      doc.text(shortTitle, pageW - marginX, 38, { align: 'right' });
    }
    doc.setFontSize(8.5);
    doc.setTextColor(140, 146, 158);
    doc.text(`${page} / ${pages}`, pageW / 2, pageH - 34, { align: 'center' });
  }

  return doc.output('blob');
}
