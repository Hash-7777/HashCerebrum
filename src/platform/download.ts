// Saving a generated file to disk, and naming it safely.
//
// Lived in the Brain feature's export module, which meant peer review and the
// execution-trace panel each reached across a feature boundary to download a
// file. Nothing about either function is Brain-specific: both are platform
// concerns, so they sit beside the platform adapter that does the work.

import { platform } from './index';

/**
 * Turn arbitrary text — a chat title, a paper title — into a filename stem.
 * Falls back to a fixed name rather than returning an empty string, so a title
 * made entirely of punctuation cannot produce a file called ".pdf".
 */
export function slugifyFilename(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'hashcerebrum-export';
}

/**
 * Save a blob under `filename`.
 *
 * Routes through the platform adapter: a native save dialog plus a write on the
 * desktop, since WKWebView ignores `<a download>` for blob URLs, and the anchor
 * download in the browser. Fire-and-forget — a genuine failure is surfaced to
 * the console, but a user cancelling the dialog is not an error.
 */
export function downloadBlob(filename: string, blob: Blob): void {
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
