// Lazy PDF page renderer for the peer-review preview. WKWebView cannot display
// a PDF blob inline in an iframe, so an uploaded PDF previewed blank. This
// renders the pages to canvases with pdf.js instead. pdf.js (and its worker)
// are only pulled in when this module is dynamically imported — i.e. the first
// time an uploaded PDF is previewed — so they never weigh down the main bundle.

import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a hashed asset URL served from the app origin, which
// satisfies the CSP `worker-src 'self' blob:`.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 40;
const RENDER_SCALE = 1.5;

export interface PdfRenderHandle {
  pageCount: number;
  rendered: number;
}

/**
 * Render up to MAX_PAGES of the PDF at `url` into freshly-created <canvas>
 * elements appended to `container`. Returns when every page is drawn or
 * `isCancelled()` flips true (component unmounted / new document selected).
 */
export async function renderPdfToCanvases(
  url: string,
  container: HTMLElement,
  isCancelled: () => boolean,
): Promise<PdfRenderHandle> {
  const doc = await pdfjsLib.getDocument({ url }).promise;
  try {
    const pageCount = doc.numPages;
    const limit = Math.min(pageCount, MAX_PAGES);
    let rendered = 0;
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      if (isCancelled()) break;
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.className = 'review-pdf-page';
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
