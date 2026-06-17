/**
 * Parent-window expansion — retrieve precise, synthesise with context.
 *
 * Imported-PDF passages are deliberately small so retrieval is sharp, but a lone
 * passage often lacks the surrounding sentences a model needs to use it well
 * (the classic small-chunk precision / large-chunk context trade-off). This
 * stitches a retrieved document passage back together with its immediate
 * neighbours from the same document (by chunkIndex), so ranking stays
 * passage-level while the text handed to synthesis carries its parent window.
 *
 * Pure and deterministic. Non-document chunks (no docId/chunkIndex) are returned
 * unchanged, so it is a safe no-op for findings and answers.
 */

import type { RagChunk } from '../types';

/**
 * The text of `chunk` joined with its same-document neighbours whose chunkIndex
 * is within `radius`, in document order. Returns the chunk's own text unchanged
 * when it is not an indexed document passage.
 */
export function parentWindowText(chunk: RagChunk, allChunks: RagChunk[], radius = 1): string {
  if (!chunk.docId || typeof chunk.chunkIndex !== 'number') return chunk.text;
  const center = chunk.chunkIndex;
  const window = allChunks
    .filter(
      (c) =>
        c.docId === chunk.docId &&
        typeof c.chunkIndex === 'number' &&
        Math.abs(c.chunkIndex - center) <= radius,
    )
    .sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));
  if (window.length <= 1) return chunk.text;
  // De-duplicate identical passage text (re-imports can leave near-dupes).
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of window) {
    const t = c.text.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    parts.push(t);
  }
  return parts.join(' ');
}
