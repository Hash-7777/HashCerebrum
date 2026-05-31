import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve(__dirname, '../DocumentPreviewWindow.tsx');
const source = fs.readFileSync(filePath, 'utf-8');

describe('DocumentPreviewWindow security', () => {
  it('has sandbox on every PDF iframe', () => {
    const iframeRegex = /<iframe[^>]*\/>/g;
    const matches = source.match(iframeRegex) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    for (const iframe of matches) {
      expect(iframe).toContain('sandbox');
    }
  });

  it('primary PDF path rasterises the real PDF with the pdf.js canvas renderer', () => {
    // The preview renders the actual exported PDF (the same bytes as the
    // download) via pdf.js canvases, so it can never visually drift from the
    // downloaded file. WKWebView cannot show a PDF blob inline, but canvas
    // rasterisation works in every host WebView.
    expect(source).toContain('PdfCanvasView');
    expect(source).toContain('@ui/pdf/pdfCanvas');
  });

  it('falls back to srcDoc HTML, then the native blob iframe, on render failure', () => {
    // If rasterisation fails (e.g. the blob is the HTML fallback produced when
    // PDF generation itself failed) the HTML render is shown; the blob URL
    // iframe is the last resort.
    expect(source).toContain('srcDoc=');
    expect(source).toContain('fallbackHtml');
    expect(source).toContain('URL.createObjectURL(document.blob)');
    expect(source).toContain('src={url}');
  });
});
