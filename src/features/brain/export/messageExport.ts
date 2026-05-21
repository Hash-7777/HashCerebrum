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
    .map((item, index) => {
      const year = item.year ? ` (${escapeHtml(String(item.year))})` : '';
      const id = item.identifiers?.pmid
        ? ` PMID:${escapeHtml(item.identifiers.pmid)}`
        : item.identifiers?.doi
          ? ` DOI:${escapeHtml(item.identifiers.doi)}`
          : '';
      return `<li>[S${index + 1}] ${escapeHtml(item.source.toUpperCase())}${year}. ${escapeHtml(item.title)}${id}</li>`;
    })
    .join('\n');
  return `<section class="references"><h2>Exported Evidence Links</h2><ol>${rows}</ol></section>`;
}

export function buildExportHtml(message: ExportableMessage): string {
  const title = message.title || 'HashCerebrum Export';
  const artifact = message.manuscript
    ? (message.manuscript.publication ?? buildPublicationArtifact(message.manuscript, message.citations ?? []))
    : null;
  const body = artifact && message.manuscript
    ? publicationHtml(
        message.manuscript,
        artifact,
        markdownToHtml(manuscriptToReadableText(normalizeManuscriptForPublication(message.manuscript, artifact))),
      )
    : markdownToHtml(message.content);
  const exportedAt = new Date().toISOString();
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #111827; line-height: 1.5; }
    header { border-bottom: 1px solid #cbd5e1; margin-bottom: 18px; padding-bottom: 10px; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    h2 { font-size: 16px; margin: 18px 0 6px; }
    h3 { font-size: 13px; margin: 14px 0 5px; }
    p, li { font-size: 10.5pt; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f1f5f9; padding: 1px 3px; border-radius: 3px; }
    .meta { color: #64748b; font-size: 9pt; }
    .content { max-width: 100%; }
    .references { break-before: auto; border-top: 1px solid #e2e8f0; margin-top: 20px; padding-top: 10px; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">HashCerebrum · ${escapeHtml(message.modelLabel ?? message.role)} · exported ${escapeHtml(exportedAt)}</div>
  </header>
  <main class="content">${body}</main>
  ${artifact ? '' : citationBlock(message.citations)}
</body>
</html>`;
}

export function buildMarkdownExport(message: ExportableMessage): string {
  if (message.manuscript) {
    const artifact = message.manuscript.publication ?? buildPublicationArtifact(message.manuscript, message.citations ?? []);
    return publicationMarkdown(message.manuscript, artifact);
  }
  const content = stripGeneratedReferenceSections(message.content);
  const citations = message.citations?.length
    ? [
        '',
        '## Exported Evidence Links',
        ...message.citations.slice(0, 40).map((item, index) => `[S${index + 1}] ${item.source.toUpperCase()}: ${item.title}`),
      ].join('\n')
    : '';
  return `# ${message.title}\n\n${content}${citations}\n`;
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
    const exportManuscript = normalizeManuscriptForPublication(message.manuscript, artifact);
    try {
      const meta = `HashCerebrum${message.modelLabel ? ` · ${message.modelLabel}` : ''} · ${new Date().toLocaleDateString()}`;
      return await platform().manuscript.renderPdf(
        exportManuscript,
        referenceLinesForPublication(artifact),
        meta,
      );
    } catch {
      /* Typst unavailable or failed — fall through to the jsPDF renderer. */
    }
    const { buildPaperPdfBlob } = await import('./paperPdf');
    return buildPaperPdfBlob({
      title: message.title,
      content: manuscriptToReadableText(exportManuscript),
      ...(message.modelLabel ? { modelLabel: message.modelLabel } : {}),
      citations: artifact.references.map((reference) => reference.evidence),
      manuscript: exportManuscript,
    });
  }

  const { buildPaperPdfBlob } = await import('./paperPdf');
  return buildPaperPdfBlob({
    title: message.title,
    content,
    ...(message.modelLabel ? { modelLabel: message.modelLabel } : {}),
    ...(message.citations ? { citations: message.citations } : {}),
    ...(message.manuscript ? { manuscript: message.manuscript } : {}),
  });
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
