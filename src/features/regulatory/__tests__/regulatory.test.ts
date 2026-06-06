import { describe, expect, it } from 'vitest';
import { generateEctd, generateInd, generateIrb, validatePackage, packageToMarkdown } from '../index';

describe('regulatory packages', () => {
  it('generates eCTD with required sections', () => {
    const pkg = generateEctd('Drug X', 'Acme Pharma', ['diabetes']);
    expect(pkg.type).toBe('ectd');
    expect(pkg.sections.some((s) => s.id === 'm1-0')).toBe(true);
  });

  it('generates IND with 10 sections', () => {
    const pkg = generateInd('IND-001', 'Acme', '1');
    expect(pkg.sections).toHaveLength(10);
    expect(pkg.metadata.phase).toBe('1');
  });

  it('generates IRB protocol', () => {
    const pkg = generateIrb('Protocol A', 'Dr. Smith', 'Site 1');
    expect(pkg.sections).toHaveLength(10);
    expect(pkg.metadata.pi).toBe('Dr. Smith');
  });

  it('flags missing required sections', () => {
    const pkg = generateInd('IND', 'Sponsor', '2');
    const v = validatePackage(pkg);
    expect(v.valid).toBe(false);
    expect(v.missing.length).toBeGreaterThan(0);
  });

  it('exports markdown', () => {
    const pkg = generateEctd('Title', 'Sponsor', ['indication']);
    const md = packageToMarkdown(pkg);
    expect(md).toContain('# Title');
    expect(md).toContain('## Module 2.5: Clinical Overview');
  });
});
