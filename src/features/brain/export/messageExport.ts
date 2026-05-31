import { platform, type EvidenceItem } from '@platform/index';
import type { ChatMessage } from '@core/store/chatHistoryStore';
import { manuscriptToReadableText, type Manuscript } from '../swarm/manuscript';
import {
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

// Convert common LaTeX inline math to readable Unicode before rendering.
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
    // Greek with subscript: $\beta_2$ → β₂
    .replace(/\$\\([A-Za-z]+)_(\d)\$/g, (_, name: string, n: string) =>
      (greek[name] ?? name) + (sub[Number(n)] ?? n))
    // Greek alone: $\beta$ → β
    .replace(/\$\\([A-Za-z]+)\$/g, (_, name: string) => greek[name] ?? name)
    // Superscript: $x^2$ → x²
    .replace(/\$(\w)\^(\d)\$/g, (_, base: string, n: string) =>
      base + (sup[Number(n)] ?? n))
    // Common operators
    .replace(/\$\\pm\$/g, '±')
    .replace(/\$\\geq?\$/g, '≥')
    .replace(/\$\\leq?\$/g, '≤')
    .replace(/\$\\times\$/g, '×')
    .replace(/\$\\neq?\$/g, '≠')
    .replace(/\$\\approx\$/g, '≈')
    .replace(/\$\\infty\$/g, '∞')
    // Strip remaining $...$ spans we can't render — show inner text without backslashes
    .replace(/\$([^$]{1,80})\$/g, (_, inner: string) =>
      inner.replace(/\\[a-zA-Z]+/g, '').replace(/[{}^_]/g, ''));
}

function inlineMarkdown(value: string): string {
  return escapeHtml(latexToUnicode(value))
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
    // Horizontal rule: ---, ***, or ___
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      closeList();
      html.push('<hr>');
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
    .map((item, i) => {
      const authors = item.authors?.length
        ? escapeHtml(
            item.authors.slice(0, 4).join(', ') + (item.authors.length > 4 ? ' et al.' : ''),
          )
        : escapeHtml(item.source.toUpperCase());
      const year = item.year ? ` (${escapeHtml(String(item.year))})` : '';
      const id = item.identifiers?.pmid
        ? ` PMID:&nbsp;${escapeHtml(item.identifiers.pmid)}.`
        : item.identifiers?.doi
          ? ` doi:&nbsp;${escapeHtml(item.identifiers.doi)}.`
          : '';
      const source = escapeHtml(item.source.toUpperCase());
      return `<li><span class="ref-num">${i + 1}.</span> ${authors}${year}. <em>${escapeHtml(item.title)}</em>. ${source}.${id}</li>`;
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
  const resolve = (original: number): string | null => {
    if (!Number.isInteger(original) || original < 1) return null;
    // Bulletproof guarantee: a marker that does not resolve to a real
    // retrieved record is dropped entirely rather than rendered. This is
    // what prevents a hallucinated "[S43]" from surviving into the body
    // and the scrambled "1, 2, 43, 6, 5" numbering the user reported.
    if (!citations[original - 1]) return null;
    let next = assigned.get(original);
    if (next === undefined) {
      next = order.length + 1;
      assigned.set(original, next);
      order.push(original);
    }
    return `[${next}]`;
  };
  // Two marker shapes are normalised to sequential [n]:
  //   1. the canonical bracketed form `[S8]`; and
  //   2. a bare marker glued to the preceding word — `inhibitionS8`,
  //      `CYP2 C19S9` — which some models emit when they drop the brackets.
  //      The glued form keeps its preceding word char and gains a space, so
  //      `inhibitionS8` → `inhibition [8]`. The trailing `(?![A-Za-z0-9])`
  //      keeps it from biting into real tokens, and any marker that fails to
  //      resolve is dropped, so a stray "S100" cannot survive as a citation.
  const rewritten = content.replace(
    /\[S(\d+)\]|([A-Za-z0-9)])S(\d+)(?![A-Za-z0-9])/g,
    (full, bracketed: string | undefined, prefix: string | undefined, glued: string | undefined) => {
      const raw = bracketed ?? glued;
      if (raw === undefined) return full;
      const rendered = resolve(Number(raw));
      if (rendered === null) return prefix ?? '';
      return prefix !== undefined ? `${prefix} ${rendered}` : rendered;
    },
  );
  // Tidy whitespace left behind by any dropped markers.
  const cleaned = rewritten.replace(/ {2,}/g, ' ').replace(/\s+([.,;:)])/g, '$1');
  if (order.length === 0) return { content: cleaned, citations };
  const cited = order
    .map((original) => citations[original - 1])
    .filter((item): item is EvidenceItem => Boolean(item));
  return { content: cleaned, citations: cited };
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
  const modelMeta = message.modelLabel ? ` · ${escapeHtml(message.modelLabel)}` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 18mm 20mm; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html { background: #e8ecf1; }

    body {
      font-family: "New York", "Iowan Old Style", "Charter", "Palatino Linotype",
                   Palatino, Georgia, "Times New Roman", serif;
      color: #18202e;
      line-height: 1.72;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      padding: 36px 22px 72px;
    }

    /* ── Page card ───────────────────────────────────────────── */
    .page {
      position: relative;
      max-width: 760px;
      margin: 0 auto;
      background: #ffffff;
      padding: 0 0 68px;
      border-radius: 8px;
      box-shadow:
        0 1px 2px rgba(0,0,0,0.05),
        0 8px 24px rgba(15,23,42,0.09),
        0 28px 72px rgba(15,23,42,0.12);
      overflow: hidden;
    }

    /* Mint accent top bar */
    .page-bar {
      height: 5px;
      background: linear-gradient(90deg, #4ec9a4 0%, #82e0c2 55%, #b2eeda 100%);
    }

    .page-inner {
      padding: 52px 64px 0;
    }

    /* ── Header ──────────────────────────────────────────────── */
    header {
      margin-bottom: 34px;
      padding-bottom: 22px;
      border-bottom: 1.5px solid #d8e2ed;
    }

    h1 {
      font-size: 28px;
      font-weight: 600;
      line-height: 1.22;
      letter-spacing: -0.018em;
      color: #0c1625;
      margin-bottom: 12px;
    }

    .meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: ui-monospace, "SF Mono", "Cascadia Mono", "Fira Code",
                   "Fira Mono", "Courier New", monospace;
      font-size: 10px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #8fa3be;
    }

    .meta-pip {
      display: inline-block;
      width: 6px;
      height: 6px;
      background: #82e0c2;
      border-radius: 1px;
      flex-shrink: 0;
    }

    /* ── Body typography ─────────────────────────────────────── */
    main.content { line-height: 1.74; }

    h2 {
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.006em;
      color: #0f1e33;
      margin: 36px 0 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e5ecf5;
    }

    h3 {
      font-size: 14px;
      font-weight: 600;
      color: #1e334f;
      margin: 24px 0 6px;
    }

    h4 {
      font-size: 13px;
      font-weight: 600;
      color: #36475e;
      margin: 16px 0 4px;
    }

    .content > h2:first-child,
    .content > h3:first-child { margin-top: 0; }

    p { font-size: 15.5px; margin: 0 0 15px; color: #18202e; }

    ul, ol { margin: 0 0 15px; padding-left: 26px; }
    li { font-size: 15.5px; margin-bottom: 7px; color: #18202e; }

    strong { font-weight: 700; color: #0f172a; }
    em { font-style: italic; }

    code {
      font-family: ui-monospace, "SF Mono", "Cascadia Mono", monospace;
      background: #f1f5fb;
      border: 1px solid #dde5f2;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.875em;
      color: #b5173e;
    }

    blockquote {
      margin: 0 0 15px;
      padding: 12px 18px;
      border-left: 3px solid #82e0c2;
      background: #f5fdfb;
      color: #334155;
      font-style: italic;
    }

    /* ── Manuscript figures ──────────────────────────────────── */
    figure { margin: 28px 0; }
    figure svg { width: 100%; max-height: 340px; border-radius: 8px; display: block; }
    figcaption {
      margin-top: 10px;
      font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 12.5px;
      color: #607080;
      line-height: 1.55;
    }

    /* ── References ─────────────────────────────────────────── */
    .references {
      margin-top: 48px;
      padding-top: 26px;
      border-top: 1.5px solid #d8e2ed;
    }

    .references h2 {
      font-family: ui-monospace, "SF Mono", monospace;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #7a96b2;
      border-bottom: none;
      padding-bottom: 0;
      margin: 0 0 16px;
    }

    .references ol {
      font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
      list-style: none;
      padding-left: 0;
    }

    .references li {
      font-size: 12.5px;
      color: #4a6078;
      line-height: 1.58;
      margin-bottom: 11px;
      padding-left: 32px;
      position: relative;
    }

    .ref-num {
      position: absolute;
      left: 0;
      top: 0;
      font-weight: 700;
      color: #82e0c2;
      font-variant-numeric: tabular-nums;
    }

    .references li em { font-style: italic; color: #334155; }

    /* ── Print overrides ─────────────────────────────────────── */
    @media print {
      html { background: #fff; }
      body { padding: 0; }
      .page {
        max-width: none;
        border-radius: 0;
        box-shadow: none;
        overflow: visible;
        padding-bottom: 0;
      }
      .page-bar { height: 3px; }
      .page-inner { padding: 28px 0 0; }
    }
  </style>
</head>
<body>
  <article class="page">
    <div class="page-bar"></div>
    <div class="page-inner">
      <header>
        <h1>${escapeHtml(title)}</h1>
        <p class="meta">
          <span class="meta-pip"></span>
          HashCerebrum${modelMeta} &nbsp;·&nbsp; ${escapeHtml(exportedAt)}
        </p>
      </header>
      <main class="content">${body}</main>
      ${artifact ? '' : citationBlock(referenceCitations)}
    </div>
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
    // A drafted manuscript always exports as a PDF. Publication-QA blockers
    // (e.g. thin evidence, an uncited section) are quality signals surfaced in
    // the pipeline, not a reason to deny the user the PDF they asked for — the
    // document still typesets. Previously assertPublicationReady threw here,
    // which silently downgraded a QA-flagged paper to an HTML download.
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

  // Renumber [S#] markers to sequential [1], [2], … in order of appearance
  // and return only the cited records in that order, so the body markers and
  // the rendered reference list line up exactly (matches the HTML path).
  const renumbered = renumberCitations(dropLeadingTitleHeading(content), message.citations ?? []);
  const { buildPaperPdfBlob } = await import('./paperPdf');
  return assertPdfBlob(
    await buildPaperPdfBlob({
      title: message.title,
      content: renumbered.content,
      ...(message.modelLabel ? { modelLabel: message.modelLabel } : {}),
      citations: renumbered.citations,
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
