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

  it('renders PDF previews through a blob object URL — preview and download use the same blob', () => {
    expect(source).toContain('URL.createObjectURL(document.blob)');
    expect(source).toContain('src={url}');
    // previewHtml was intentionally removed: in-app preview and download now
    // both render the same Typst/jsPDF blob so they look identical.
    expect(source).not.toContain('srcDoc={document.previewHtml}');
  });
});
