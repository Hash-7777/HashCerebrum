import { platform, type EvidenceItem } from '@platform/index';
import type { ChatMessage } from '@core/store/chatHistoryStore';
import { manuscriptToReadableText, type Manuscript } from '../swarm/manuscript';
import {
  assertPublicationReady,
  buildPublicationArtifact,
  normalizeManuscriptForPublication,
  publicationHtml,
  publicationMarkdown,
  referenceLinesForPublication,
} from '../swarm/publication';

const MIN_PDF_BYTES = 256;

export interface ExportableMessage {
  title: string;
  role: ChatMessage['role'];
  content: string;
  modelLabel?: string;
  citations?: EvidenceItem[];
  manuscript?: Manuscript;
}

export function slugifyFilename(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'hashcerebrum-export';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownToHtml(markdown: string): string {
  const lines = stripGeneratedReferenceSections(markdown).replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let listOpen: 'ul' | 'ol' | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listOpen) return;
    html.push(`</${listOpen}>`);
    listOpen = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(heading[1]!.length, 4);
      html.push(`<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`);
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (listOpen !== 'ul') {
        closeList();
        listOpen = 'ul';
        html.push('<ul>');
      }
      html.push(`<li>${inlineMarkdown(bullet[1]!)}</li>`);
      continue;
    }
    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      if (listOpen !== 'ol') {
        closeList();
        listOpen = 'ol';
        html.push('<ol>');
      }
      html.push(`<li>${inlineMarkdown(numbered[1]!)}</li>`);
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();
  closeList();
  return html.join('\n');
}

function citationBlock(citations: EvidenceItem[] = []): string {
  if (citations.length === 0) return '';
  const rows = citations
    .slice(0, 40)
    .map((item) => {
      const year = item.year ? ` (${escapeHtml(String(item.year))})` : '';
      const id = item.identifiers?.pmid
        ? ` PMID:${escapeHtml(item.identifiers.pmid)}`
        : item.identifiers?.doi
          ? ` DOI:${escapeHtml(item.identifiers.doi)}`
          : '';
      return `<li>${escapeHtml(item.source.toUpperCase())}${year}. ${escapeHtml(item.title)}${id}</li>`;
    })
    .join('\n');
  return `<section class="references"><h2>References</h2><ol>${rows}</ol></section>`;
}

// Rewrite [S<n>] evidence markers as sequential [1], [2], … in order of
// first appearance (Vancouver numbering), and return the cited evidence
// in that same order so the reference list lines up with the body.
export function renumberCitations(
  content: string,
  citations: EvidenceItem[],
): { content: string; citations: EvidenceItem[] } {
  const assigned = new Map<number, number>();
  const order: number[] = [];
  const rewritten = content.replace(/\[S(\d+)\]/g, (full, raw: string) => {
    const original = Number(raw);
    if (!Number.isInteger(original) || original < 1) return full;
    let next = assigned.get(original);
    if (next === undefined) {
      next = order.length + 1;
      assigned.set(original, next);
      order.push(original);
    }
    return `[${next}]`;
  });
  if (order.length === 0) return { content: rewritten, citations };
  const cited = order
    .map((original) => citations[original - 1])
    .filter((item): item is EvidenceItem => Boolean(item));
  return { content: rewritten, citations: cited };
}

// Drop a leading level-1 markdown heading — the export already prints the
// title in its own header block, so a repeated `# Title` line is noise.
function dropLeadingTitleHeading(markdown: string): string {
  const lines = markdown.split('\n');
  const first = lines.findIndex((line) => line.trim());
  if (first >= 0 && /^#\s+\S/.test(lines[first]!.trim())) {
    lines.splice(first, 1);
  }
  return lines.join('\n').replace(/^\n+/, '');
}

export function buildExportHtml(message: ExportableMessage): string {
  const title = message.title || 'HashCerebrum Export';
  const artifact = message.manuscript
    ? (message.manuscript.publication ?? buildPublicationArtifact(message.manuscript, message.citations ?? []))
    : null;

  let body: string;
  let referenceCitations: EvidenceItem[] = [];
  if (artifact && message.manuscript) {
    body = publicationHtml(
      message.manuscript,
      artifact,
      markdownToHtml(manuscriptToReadableText(normalizeManuscriptForPublication(message.manuscript, artifact))),
    );
  } else {
    const cleaned = dropLeadingTitleHeading(stripGeneratedReferenceSections(message.content));
    const renumbered = renumberCitations(cleaned, message.citations ?? []);
    body = markdownToHtml(renumbered.content);
    referenceCitations = renumbered.citations;
  }

  const exportedAt = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 16mm 18mm; }
    * { box-sizing: border-box; }
    html { background: #eceff3; }
    body {
      margin: 0;
      padding: 30px 18px 56px;
      font-family: "Iowan Old Style", "Charter", Georgia, "Times New Roman", serif;
      color: #1b2330;
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      display: block;
      max-width: 730px;
      margin: 0 auto;
      background: #ffffff;
      padding: 52px 60px 60px;
      border: 1px solid #d6dce4;
      border-radius: 5px;
      box-shadow: 0 14px 44px rgba(17, 24, 39, 0.16);
    }
    header { margin-bottom: 26px; padding-bottom: 16px; border-bottom: 2px solid #1b2330; }
    h1 { margin: 0 0 10px; font-size: 26px; font-weight: 600; line-height: 1.24; letter-spacing: -0.012em; }
    .meta {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: #8a93a3;
    }
    h2 { margin: 28px 0 8px; font-size: 16.5px; font-weight: 600; letter-spacing: -0.005em; }
    h3 { margin: 18px 0 5px; font-size: 13.5px; font-weight: 600; }
    h4 { margin: 14px 0 4px; font-size: 12.5px; font-weight: 600; }
    p { margin: 0 0 13px; font-size: 15px; }
    ul, ol { margin: 0 0 13px; padding-left: 24px; }
    li { font-size: 15px; margin: 0 0 5px; }
    strong { font-weight: 600; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #f1f4f8;
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 0.86em;
    }
    .content > h2:first-child, .content > h3:first-child { margin-top: 0; }
    .references { margin-top: 34px; padding-top: 18px; border-top: 1px solid #d6dce4; }
    .references h2 { margin-top: 0; }
    .references ol { font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .references li { font-size: 12.5px; color: #44505f; line-height: 1.5; margin-bottom: 7px; }
    @media print {
      html { background: #ffffff; }
      body { padding: 0; }
      .page { max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <article class="page">
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p class="meta">HashCerebrum · Exported ${escapeHtml(exportedAt)}</p>
    </header>
    <main class="content">${body}</main>
    ${artifact ? '' : citationBlock(referenceCitations)}
  </article>
</body>
</html>`;
}

export function buildMarkdownExport(message: ExportableMessage): string {
  if (message.manuscript) {
    const artifact = message.manuscript.publication ?? buildPublicationArtifact(message.manuscript, message.citations ?? []);
    return publicationMarkdown(message.manuscript, artifact);
  }
  const renumbered = renumberCitations(stripGeneratedReferenceSections(message.content), message.citations ?? []);
  const citations = renumbered.citations.length
    ? [
        '',
        '## References',
        ...renumbered.citations
          .slice(0, 40)
          .map((item, index) => `${index + 1}. ${item.source.toUpperCase()}: ${item.title}`),
      ].join('\n')
    : '';
  return `# ${message.title}\n\n${renumbered.content}${citations}\n`;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadTextFile(filename: string, body: string, mime: string): void {
  downloadBlob(filename, new Blob([body], { type: mime }));
}

function assertPdfBlob(blob: Blob, renderer: string): Blob {
  if (blob.size < MIN_PDF_BYTES) {
    throw new Error(`${renderer} returned an empty or invalid PDF (${blob.size} bytes).`);
  }
  if (blob.type && !/pdf/i.test(blob.type)) {
    throw new Error(`${renderer} returned ${blob.type}, not application/pdf.`);
  }
  return blob;
}

export function exportMessageMarkdown(message: ExportableMessage): void {
  downloadTextFile(`${slugifyFilename(message.title)}.md`, buildMarkdownExport(message), 'text/markdown;charset=utf-8');
}

export function exportMessageHtml(message: ExportableMessage): void {
  downloadTextFile(`${slugifyFilename(message.title)}.html`, buildExportHtml(message), 'text/html;charset=utf-8');
}

export function stripGeneratedReferenceSections(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(references|bibliography|works cited|exported evidence links)\s*$/i);
    if (heading) {
      skipping = true;
      continue;
    }
    if (skipping && /^#{1,6}\s+\S/.test(line)) {
      skipping = false;
    }
    if (!skipping) out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function buildMessagePdfBlob(message: ExportableMessage): Promise<Blob> {
  const content = stripGeneratedReferenceSections(message.content);

  if (message.manuscript) {
    const artifact = message.manuscript.publication ?? buildPublicationArtifact(message.manuscript, message.citations ?? []);
    assertPublicationReady(artifact);
    const typstManuscript = normalizeManuscriptForPublication(message.manuscript, artifact, {
      includeSupplementalSection: false,
    });
    try {
      const meta = `HashCerebrum${message.modelLabel ? ` · ${message.modelLabel}` : ''} · ${new Date().toLocaleDateString()}`;
      return assertPdfBlob(
        await platform().manuscript.renderPdf(
          typstManuscript,
          referenceLinesForPublication(artifact),
          meta,
        ),
        'Typst renderer',
      );
    } catch {
      /* Typst unavailable or failed — fall through to the jsPDF renderer. */
    }
    const exportManuscript = normalizeManuscriptForPublication(message.manuscript, artifact);
    const { buildPaperPdfBlob } = await import('./paperPdf');
    return assertPdfBlob(
      await buildPaperPdfBlob({
        title: message.title || exportManuscript.title,
        content: manuscriptToReadableText(exportManuscript),
        ...(message.modelLabel ? { modelLabel: message.modelLabel } : {}),
        citations: artifact.references.map((reference) => reference.evidence),
        manuscript: exportManuscript,
      }),
      'jsPDF manuscript renderer',
    );
  }

  const { buildPaperPdfBlob } = await import('./paperPdf');
  return assertPdfBlob(
    await buildPaperPdfBlob({
      title: message.title,
      content,
      ...(message.modelLabel ? { modelLabel: message.modelLabel } : {}),
      ...(message.citations ? { citations: message.citations } : {}),
      ...(message.manuscript ? { manuscript: message.manuscript } : {}),
    }),
    'jsPDF message renderer',
  );
}

// Build a publishable research-paper PDF and save it. A structured
// manuscript is typeset by the embedded Typst engine; jsPDF is the
// fallback when Typst is unavailable (browser dev) or fails. The webview
// routes the download to the user's Downloads folder.
export async function exportMessagePdf(message: ExportableMessage): Promise<void> {
  const filename = `${slugifyFilename(message.title)}.pdf`;
  const blob = await buildMessagePdfBlob(message);
  downloadBlob(filename, blob);
}
