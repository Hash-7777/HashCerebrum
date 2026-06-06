import { describe, expect, it } from 'vitest';
import { deidentifyText, deidentifyWithReport, deidentifyRecord } from '../deidentify';

describe('deidentify', () => {
  it('strips SSNs', () => {
    const text = 'Patient SSN is 123-45-6789 for billing';
    expect(deidentifyText(text)).toBe('Patient SSN is [SSN] for billing');
  });

  it('strips emails', () => {
    const text = 'Contact john.doe@hospital.org for results';
    expect(deidentifyText(text)).toContain('[EMAIL]');
    expect(deidentifyText(text)).not.toContain('john.doe@hospital.org');
  });

  it('strips phone numbers', () => {
    const text = 'Call (555) 123-4567 to schedule';
    expect(deidentifyText(text)).toContain('[PHONE]');
  });

  it('strips dates', () => {
    const text = 'Admission on 03/15/2024 and discharge 04/01/2024';
    const out = deidentifyText(text);
    expect(out).not.toContain('03/15/2024');
    expect(out).toContain('[DATE]');
  });

  it('strips addresses', () => {
    const text = 'Lives at 123 Main Street, Apt 4B';
    expect(deidentifyText(text)).toContain('[ADDRESS]');
  });

  it('strips URLs and IPs', () => {
    const text = 'Server at 192.168.1.1 or https://internal.hospital.org';
    const out = deidentifyText(text);
    expect(out).toContain('[IP]');
    expect(out).toContain('[URL]');
  });

  it('reports replacements', () => {
    const result = deidentifyWithReport('SSN: 123-45-6789, email: a@b.com');
    expect(result.text).toContain('[SSN]');
    expect(result.text).toContain('[EMAIL]');
    expect(result.replacements.some((r) => r.category === 'ssn')).toBe(true);
    expect(result.replacements.some((r) => r.category === 'email')).toBe(true);
  });

  it('de-identifies record values', () => {
    const record = {
      name: 'Dr. Smith',
      notes: 'Patient email is foo@bar.com',
      age: 45,
      tags: ['urgent', 'SSN 123-45-6789'],
    };
    const out = deidentifyRecord(record);
    expect(out.notes).toContain('[EMAIL]');
    expect(out.tags).toEqual(['urgent', 'SSN [SSN]']);
    expect(out.age).toBe(45);
  });
});
