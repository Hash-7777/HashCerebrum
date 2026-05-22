import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve(__dirname, '../DocumentPreviewWindow.tsx');
const source = fs.readFileSync(filePath, 'utf-8');

describe('DocumentPreviewWindow security', () => {
  it('has sandbox on every PDF iframe', () => {
    const iframeRegex = /<iframe[^>]*\/>/g;
    const matches = source.match(iframeRegex) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const iframe of matches) {
      expect(iframe).toContain('sandbox');
    }
  });
});
