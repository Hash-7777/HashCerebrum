// Peer-review PDF preview renderer. Thin wrapper over the shared pdf.js canvas
// renderer (src/ui/pdf/pdfCanvas.ts) that keeps the review-specific page class
// so the existing `.review-pdf-page` styling continues to apply.

import { renderPdfToCanvases as render, type PdfRenderHandle } from '@ui/pdf/pdfCanvas';

export type { PdfRenderHandle };

export function renderPdfToCanvases(
  url: string,
  container: HTMLElement,
  isCancelled: () => boolean,
): Promise<PdfRenderHandle> {
  return render(url, container, isCancelled, { canvasClassName: 'review-pdf-page' });
}
