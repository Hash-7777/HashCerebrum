// Shared lazy PDF page renderer. A WKWebView (Tauri) cannot display a PDF blob
// inline in an iframe, so any in-app PDF preview must rasterise the pages with
// pdf.js instead. pdf.js (and its worker) are only pulled in when this module
// is dynamically imported — i.e. the first time a PDF is previewed — so they
// never weigh down the main bundle. Used by both the peer-review preview and
// the Brain document-export preview so the in-app view matches the file the
// user downloads exactly (one renderer, not two).

import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a hashed asset URL served from the app origin, which
// satisfies the CSP `worker-src 'self' blob:`.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const DEFAULT_MAX_PAGES = 40;
const DEFAULT_RENDER_SCALE = 1.5;

export interface PdfRenderHandle {
  pageCount: number;
  rendered: number;
}

export interface RenderPdfOptions {
  /** Class applied to each generated <canvas> page. */
  canvasClassName?: string;
  /** Render resolution multiplier (higher = crisper, heavier). */
  scale?: number;
  /** Safety cap on how many pages are rasterised. */
  maxPages?: number;
}

/**
 * Render up to `maxPages` of the PDF at `url` into freshly-created <canvas>
 * elements appended to `container`. Returns when every page is drawn or
 * `isCancelled()` flips true (component unmounted / new document selected).
 */
export async function renderPdfToCanvases(
  url: string,
  container: HTMLElement,
  isCancelled: () => boolean,
  options: RenderPdfOptions = {},
): Promise<PdfRenderHandle> {
  const canvasClassName = options.canvasClassName ?? 'pdf-canvas-page';
  const scale = options.scale ?? DEFAULT_RENDER_SCALE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const doc = await pdfjsLib.getDocument({ url }).promise;
  try {
    const pageCount = doc.numPages;
    const limit = Math.min(pageCount, maxPages);
    let rendered = 0;
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      if (isCancelled()) break;
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.className = canvasClassName;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        page.cleanup();
        continue;
      }
      if (isCancelled()) {
        page.cleanup();
        break;
      }
      container.appendChild(canvas);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      rendered += 1;
    }
    return { pageCount, rendered };
  } finally {
    await doc.destroy();
  }
}
