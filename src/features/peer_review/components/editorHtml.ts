// Text-to-HTML for the review editor and its read-only preview: the paper's
// paragraphs escaped and wrapped, each pending suggestion's passage marked in
// place, and the plain-text replace and mark operations the editor performs on
// the live document. Every interpolated value is escaped, and a link counts as
// safe only when its protocol is http or https.

import type { ReviewedPaper } from '@core/store/peerReviewStore';
import type { Suggestion, SuggestionType } from '../reviewSwarm';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function isSafeUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function currentDocumentText(paper: ReviewedPaper): string {
  return paper.editedText ?? paper.text;
}

export function textToPreviewHtml(text: string): string {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return '<p></p>';
  return blocks
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function buildHighlightedHtml(text: string, suggestions: Suggestion[]): string {
  type Span = { start: number; end: number; sid: string; type: SuggestionType };
  const spans: Span[] = [];

  for (const s of suggestions) {
    if (s.status !== 'pending') continue;
    const idx = text.indexOf(s.originalText);
    if (idx === -1) continue;
    if (!s.originalText) continue; // unanchored — no mark to place
    const overlaps = spans.some(
      (sp) => idx < sp.end && idx + s.originalText.length > sp.start,
    );
    if (overlaps) continue;
    spans.push({
      start: idx,
      end: idx + s.originalText.length,
      sid: s.id,
      type: s.type,
    });
  }

  spans.sort((a, b) => a.start - b.start);

  let html = '';
  let cursor = 0;
  for (const span of spans) {
    html += escapeHtml(text.slice(cursor, span.start));
    html +=
      `<mark class="doc-mark doc-mark--${escapeHtml(span.type)}" data-sid="${escapeHtml(span.sid)}">` +
      escapeHtml(text.slice(span.start, span.end)) +
      '</mark>';
    cursor = span.end;
  }
  html += escapeHtml(text.slice(cursor));
  // Preserve line-breaks visually
  html = html.replace(/\n/g, '<br>');
  return html;
}

function firstTextNodeContaining(root: HTMLElement, needle: string): Text | null {
  if (!needle) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.textContent ?? '').includes(needle)) return node as Text;
    node = walker.nextNode();
  }
  return null;
}

export function replaceFirstPlainText(root: HTMLElement, needle: string, replacement: string, className: string): boolean {
  const node = firstTextNodeContaining(root, needle);
  if (!node) return false;
  const text = node.textContent ?? '';
  const index = text.indexOf(needle);
  if (index < 0) return false;
  const before = document.createTextNode(text.slice(0, index));
  const after = document.createTextNode(text.slice(index + needle.length));
  const span = document.createElement('span');
  span.className = className;
  span.textContent = replacement;
  node.replaceWith(before, span, after);
  return true;
}

export function markFirstPlainText(
  root: HTMLElement,
  needle: string,
  sid: string,
  type: SuggestionType,
): boolean {
  const node = firstTextNodeContaining(root, needle);
  if (!node) return false;
  const text = node.textContent ?? '';
  const index = text.indexOf(needle);
  if (index < 0) return false;
  const before = document.createTextNode(text.slice(0, index));
  const after = document.createTextNode(text.slice(index + needle.length));
  const mark = document.createElement('mark');
  mark.className = `doc-mark doc-mark--${type}`;
  mark.dataset.sid = sid;
  mark.textContent = needle;
  node.replaceWith(before, mark, after);
  return true;
}
