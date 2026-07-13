import { platform, type EvidenceItem } from '@platform/index';
import type { ChatMessage, TurnTraceEntry } from '@core/store/chatHistoryStore';
import { manuscriptToReadableText, withNumberedSectionHeadings, type Manuscript } from '../swarm/manuscript';
import {
  buildPublicationArtifact,
  normalizeManuscriptForPublication,
  publicationHtml,
  publicationMarkdown,
  referenceLinesForPublication,
} from '../swarm/publication';
import { formatReference, referenceUrl, type CitationStyle } from './citationStyles';
import { expandCitationMarkers } from '../swarm/citationMarkers';
import { currentCitationStyle } from '@core/store/exportSettingsStore';

const MIN_PDF_BYTES = 256;

export interface ExportableMessage {
  title: string;
  role: ChatMessage['role'];
  content: string;
  modelLabel?: string;
  citations?: EvidenceItem[];
  manuscript?: Manuscript;
}

// Rebuild the publication artifact for export using the CURRENT publication
// logic (so any later fix to citation normalisation, the honesty pass, or figure
// rendering takes effect — see buildMarkdownExport's note on why we never reuse
// the cached artifact verbatim), while re-feeding the pipeline inputs the
// pipeline computed at generation time. Those inputs — the evidence extractions
// and claim ledger — are preserved on manuscript.publication. Without them a
// plain buildPublicationArtifact(manuscript, citations) cannot recompute the
// random-effects meta-analysis forest plot, the evidence-strength chart, or the
// numeric-yield chart, so every PDF/Word/Markdown export silently dropped them.
function exportArtifact(manuscript: Manuscript, citations: EvidenceItem[]) {
  const prev = manuscript.publication;
  return buildPublicationArtifact(manuscript, citations, {
    ...(prev?.standard ? { standard: prev.standard } : {}),
    ...(prev?.manuscriptType ? { manuscriptType: prev.manuscriptType } : {}),
    ...(prev?.evidenceExtractions ? { evidenceExtractions: prev.evidenceExtractions } : {}),
    ...(prev?.claimLedger ? { claimLedger: prev.claimLedger } : {}),
    ...(prev?.paperBlueprint ? { paperBlueprint: prev.paperBlueprint } : {}),
    ...(prev?.paperQa ? { paperQa: prev.paperQa } : {}),
  });
}

// Derive a clean human title from a message's content (for the artifact card and
// the export filename). Skips a bare label line like "Title:" or "**Title:**",
// strips markdown (bold/italic/code/heading marks), and drops a leading "Title:"
// label — so the title never renders as the literal "**Title:**".
// Cut a long title at the last word boundary before `max` rather than mid-word,
// appending an ellipsis only when the title was actually shortened — so a full
// "…Inhaler Technique Education: An Evidence Review" is never sliced to "…An".
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

export function deriveDocumentTitle(content: string, fallback: string): string {
  for (const raw of content.split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    line = line
      .replace(/^#{1,6}\s*/, '') // heading marks
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1') // italic
      .replace(/`([^`]*)`/g, '$1') // inline code
      .replace(/^[*_>\s-]+/, '') // stray leading markers
      .trim();
    line = line.replace(/^title\s*[:：\-—]\s*/i, '').trim(); // drop a "Title:" label
    if (line) return truncateAtWord(line, 130);
  }
  return fallback;
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

function citationBlock(citations: EvidenceItem[] = [], style: CitationStyle = 'vancouver'): string {
  if (citations.length === 0) return '';
  const rows = citations
    .slice(0, 40)
    .map((item, i) => {
      const text = escapeHtml(formatReference(item, style));
      const url = referenceUrl(item);
      const body = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${text}</a>` : text;
      return `<li><span class="ref-num">${i + 1}.</span> ${body}</li>`;
    })
    .join('\n');
  return `<section class="references"><h2>References</h2><ol>${rows}</ol></section>`;
}

// Citation markers can arrive in non-canonical shapes that the renumber pass
// below would otherwise miss and leak verbatim into the exported document:
//   • fullwidth / CJK brackets — 【S2】 〔S2〕 ［S2］ — which some models emit;
//   • ranges — [S1-S9] (incl. the U+2011 non-breaking hyphen and en/em dashes);
//   • groups — [S25, S27] — a comma/semicolon list of several markers.
// All are expanded to the canonical [S<n>] form (see citationMarkers.ts) so the
// single-marker pass can handle everything uniformly.
// Any residual *bracketed* internal marker (canonical or fullwidth) that
// survives the renumber pass — stripped as a last-resort guard so nothing
// internal can reach the PDF/MD. A bare, unbracketed "S100" in prose is left
// alone deliberately: it is not a citation marker.
const RESIDUAL_BRACKET_MARKER = /[[【〔]\s*S\d+\s*[\]】〕]/g;

function normaliseCitationMarkers(content: string, citationCount: number): string {
  return expandCitationMarkers(content, citationCount);
}

const TIDY_MARKER_GAPS = (text: string): string =>
  text.replace(/ {2,}/g, ' ').replace(/\s+([.,;:)])/g, '$1');

/**
 * Strip any residual *bracketed* internal source marker ([S#], 【S#】) from a
 * block of text. Used so copied/previewed text never shows internal labels even
 * when it does not go through the full renumber pass.
 */
export function stripResidualSourceMarkers(content: string): string {
  return TIDY_MARKER_GAPS(content.replace(RESIDUAL_BRACKET_MARKER, ''));
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
  // Normalise fullwidth brackets and expand ranges so the marker pass sees only
  // canonical [S<n>] forms.
  const normalised = normaliseCitationMarkers(content, citations.length);
  const rewritten = normalised.replace(
    /\[S(\d+)\]|([A-Za-z0-9)])S(\d+)(?![A-Za-z0-9])/g,
    (full, bracketed: string | undefined, prefix: string | undefined, glued: string | undefined) => {
      const raw = bracketed ?? glued;
      if (raw === undefined) return full;
      const rendered = resolve(Number(raw));
      if (rendered === null) return prefix ?? '';
      return prefix !== undefined ? `${prefix} ${rendered}` : rendered;
    },
  );
  // Last-resort guard: drop any residual bracketed internal marker that slipped
  // past (an odd fullwidth variant, a marker the pass could not resolve), then
  // tidy whitespace left behind by dropped markers.
  const cleaned = TIDY_MARKER_GAPS(rewritten.replace(RESIDUAL_BRACKET_MARKER, ''));
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
  const style = currentCitationStyle();
  const artifact = message.manuscript
    ? exportArtifact(message.manuscript, message.citations ?? [])
    : null;

  let body: string;
  let referenceCitations: EvidenceItem[] = [];
  if (artifact && message.manuscript) {
    body = publicationHtml(
      message.manuscript,
      artifact,
      markdownToHtml(manuscriptToReadableText(normalizeManuscriptForPublication(message.manuscript, artifact))),
      style,
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
      ${artifact ? '' : citationBlock(referenceCitations, style)}
    </div>
  </article>
</body>
</html>`;
}

export function buildMarkdownExport(message: ExportableMessage): string {
  const style = currentCitationStyle();
  if (message.manuscript) {
    // Rebuild with the CURRENT publication logic rather than reusing
    // message.manuscript.publication verbatim — the cached artifact was produced
    // by the publication logic in force at generation time, so after any fix to
    // citation normalisation / the honesty pass the preview and export would keep
    // showing the pre-fix document. exportArtifact rebuilds with today's logic
    // while re-feeding the preserved extractions + ledger so the figures survive.
    const artifact = exportArtifact(message.manuscript, message.citations ?? []);
    return publicationMarkdown(message.manuscript, artifact, style);
  }
  const renumbered = renumberCitations(stripGeneratedReferenceSections(message.content), message.citations ?? []);
  const citations = renumbered.citations.length
    ? [
        '',
        '## References',
        ...renumbered.citations
          .slice(0, 40)
          .map((item, index) => {
            const text = formatReference(item, style);
            const url = referenceUrl(item);
            const body = url ? `[${text.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}](${url})` : text;
            return `${index + 1}. ${body}`;
          }),
      ].join('\n')
    : '';
  return `# ${message.title}\n\n${renumbered.content}${citations}\n`;
}

export function downloadBlob(filename: string, blob: Blob): void {
  // Route through the platform: a native save dialog + write on the desktop
  // (WKWebView ignores <a download> for blob URLs), the anchor download in the
  // browser. Fire-and-forget; surface a failure but never a cancel.
  void platform()
    .files.save(filename, blob)
    .catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[downloadBlob] save failed:', detail);
    });
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

// Word export. We emit the export HTML wrapped with the Office namespaces so
// Word opens it as an editable document (a .doc that round-trips through
// Word/Pages/LibreOffice) — no extra dependency, and the layout, headings and
// styled reference list carry over from the HTML path.
export function buildWordDoc(message: ExportableMessage): string {
  const html = buildExportHtml(message);
  return html.replace(
    /<html lang="en">/,
    `<html lang="en" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">`,
  );
}

export function exportMessageDoc(message: ExportableMessage): void {
  downloadTextFile(`${slugifyFilename(message.title)}.doc`, buildWordDoc(message), 'application/msword');
}

export async function exportMessageDocx(message: ExportableMessage): Promise<void> {
  if (!message.manuscript) {
    // Fallback to the legacy HTML-wrapped doc for non-manuscript messages
    exportMessageDoc(message);
    return;
  }
  const artifact = exportArtifact(message.manuscript, message.citations ?? []);
  const exportManuscript = normalizeManuscriptForPublication(message.manuscript, artifact, {
    includeSupplementalSection: false,
  });
  const { buildDocxBlob } = await import('./docxExport');
  const blob = await buildDocxBlob(
    exportManuscript,
    artifact.references.map((r) => r.evidence),
    currentCitationStyle(),
  );
  downloadBlob(`${slugifyFilename(message.title)}.docx`, blob);
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
    const artifact = exportArtifact(message.manuscript, message.citations ?? []);
    // A drafted manuscript always exports as a PDF. Publication-QA blockers
    // (e.g. thin evidence, an uncited section) are quality signals surfaced in
    // the pipeline, not a reason to deny the user the PDF they asked for — the
    // document still typesets. Previously assertPublicationReady threw here,
    // which silently downgraded a QA-flagged paper to an HTML download.
    const typstBase = normalizeManuscriptForPublication(message.manuscript, artifact, {
      includeSupplementalSection: false,
    });
    // Number the body sections in the PDF exactly as the readable-text and HTML
    // views do (the Typst renderer keeps heading numbering off), so every export
    // reads like a published paper.
    const typstManuscript = {
      ...typstBase,
      sections: withNumberedSectionHeadings(typstBase.sections),
    };
    try {
      const meta = `HashCerebrum${message.modelLabel ? ` · ${message.modelLabel}` : ''} · ${new Date().toLocaleDateString()}`;
      return assertPdfBlob(
        await platform().manuscript.renderPdf(
          typstManuscript,
          referenceLinesForPublication(artifact, currentCitationStyle()),
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

export interface ChatExportMeta {
  title: string;
  mode?: string | undefined;
  project?: string | undefined;
  messageCount: number;
}

function formatChatCitations(citations: EvidenceItem[] | undefined): string {
  if (!citations || citations.length === 0) return '';
  const lines = citations.map((c, i) => {
    const authors = c.authors.slice(0, 3).join(', ');
    const etAl = c.authors.length > 3 ? ' et al.' : '';
    const year = c.year ? ` (${c.year})` : '';
    return `${i + 1}. ${authors}${etAl}${year}. ${c.title}. ${c.source}.`;
  });
  return `\n\n### Citations\n\n${lines.join('\n\n')}`;
}

function formatTrace(trace: TurnTraceEntry[] | undefined): string {
  if (!trace || trace.length === 0) return '';
  const lines = trace.map((t) => `- **${t.agent}** · ${t.phase} — ${t.detail}`);
  return `\n### Execution Trace\n\n${lines.join('\n')}\n`;
}

export function buildChatMarkdownExport(
  messages: ChatMessage[],
  meta: ChatExportMeta,
): string {
  const exportedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const modeLine = meta.mode ? ` | **Mode:** ${meta.mode}` : '';
  const projectLine = meta.project ? ` | **Project:** ${meta.project}` : '';

  let out = `# Chat Transcript: ${meta.title}\n\n`;
  out += `**Messages:** ${meta.messageCount}${modeLine}${projectLine} | **Exported:** ${exportedAt}\n\n`;
  out += '---\n';

  let msgIndex = 0;
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (!message.content.trim() && !message.manuscript && !message.outlineProposal) continue;

    msgIndex += 1;
    const roleLabel = message.role === 'user' ? 'user' : 'assistant';
    const modelTag = message.modelLabel ? ` (${message.modelLabel})` : '';
    const failoverTag = message.failoverNote ? ` [failover: ${message.failoverNote}]` : '';

    out += `\n## Message ${msgIndex} — ${roleLabel}${modelTag}${failoverTag}\n\n`;

    // Renumber inline [S#] markers to sequential [1], [2], … and reduce the
    // citation list to exactly what the body cites, in the same order — the same
    // pass every other export path uses. Without it the transcript dumped raw
    // [S#] source indices (up to [S95]) against a 1..N list, so any marker beyond
    // the list dangled and the numbers never lined up.
    const renumbered = renumberCitations(stripGeneratedReferenceSections(message.content), message.citations ?? []);
    if (renumbered.content.trim()) {
      out += `${renumbered.content.trim()}\n`;
    }

    if (renumbered.citations.length > 0) {
      out += formatChatCitations(renumbered.citations);
      out += '\n';
    }

    if (message.error) {
      out += `\n### Error\n\n\`\`\`\n${message.error}\n\`\`\`\n`;
    }

    if (message.critiqueOf) {
      out += `\n> **Critique of message:** ${message.critiqueOf}\n`;
    }

    if (message.manuscript) {
      out += `\n### Manuscript\n\n**Title:** ${message.manuscript.title}\n\n`;
      if (message.manuscript.abstract?.background) {
        out += `**Background:** ${message.manuscript.abstract.background}\n\n`;
      }
      if (message.manuscript.keywords?.length) {
        out += `**Keywords:** ${message.manuscript.keywords.join(', ')}\n\n`;
      }
    }

    if (message.outlineProposal) {
      out += `\n### Outline Proposal\n\n**Query:** ${message.outlineProposal.query}\n`;
    }

    out += formatTrace(message.trace);
    out += '\n---\n';
  }

  return out.trim() + '\n';
}

export function exportChatMarkdown(
  messages: ChatMessage[],
  meta: ChatExportMeta,
): void {
  // Contain any failure building or saving the transcript so a click on Export MD
  // can never surface as an unhandled error.
  try {
    const body = buildChatMarkdownExport(messages, meta);
    const filename = `${slugifyFilename(meta.title)}-chat.md`;
    downloadTextFile(filename, body, 'text/markdown;charset=utf-8');
  } catch (err) {
    console.error('[exportChatMarkdown] failed:', err instanceof Error ? err.message : String(err));
  }
}

export async function exportChatPdf(
  messages: ChatMessage[],
  meta: ChatExportMeta,
): Promise<void> {
  try {
    const markdown = buildChatMarkdownExport(messages, meta);
    const { buildPaperPdfBlob } = await import('./paperPdf');
    const blob = await buildPaperPdfBlob({ title: meta.title, content: markdown });
    const filename = `${slugifyFilename(meta.title)}-chat.pdf`;
    downloadBlob(filename, assertPdfBlob(blob, 'jsPDF chat renderer'));
  } catch (err) {
    console.error('[exportChatPdf] failed:', err instanceof Error ? err.message : String(err));
  }
}
