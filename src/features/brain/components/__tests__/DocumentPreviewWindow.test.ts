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

  it('primary PDF path renders via srcDoc HTML (Tauri WKWebView compatible)', () => {
    // The primary display path uses srcDoc with pre-built HTML so the preview
    // works in every host WebView, including Tauri's WKWebView which cannot
    // render PDF blobs inline in iframes.
    expect(source).toContain('srcDoc=');
    expect(source).toContain('htmlContent');
  });

  it('blob URL path retained as fallback for non-Tauri environments', () => {
    // The blob URL path is kept so the component still works when htmlContent
    // is absent (e.g. legacy call-sites that predate the htmlContent field).
    expect(source).toContain('URL.createObjectURL(document.blob)');
    expect(source).toContain('src={url}');
  });
});
