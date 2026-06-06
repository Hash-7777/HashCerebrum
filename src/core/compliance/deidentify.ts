// HIPAA Safe Harbor De-identification — remove the 18 identifier categories
// from free-text and tabular data before storage, export, or RAG indexing.
//
// This is a best-effort regex-based stripper suitable for pre-processing
// biomedical text and datasets. It does NOT guarantee full Safe Harbor
// compliance — always verify with your institution's privacy officer.

const PATTERNS: { name: string; regex: RegExp; replacement: string }[] = [
  // 1. Names (simplified — capitalised word sequences, conservative to avoid over-strip)
  { name: 'name', regex: /\b(?:Dr|Mr|Mrs|Ms|Prof)\.?\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\b/g, replacement: '[NAME]' },
  // 2. Geographic subdivisions smaller than state
  { name: 'address', regex: /\b\d{1,5}\s+[A-Za-z0-9\s,.-]+(?:Avenue|Street|St|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Suite|Apartment|Apt|Unit|Floor|Fl)\.?\b/gi, replacement: '[ADDRESS]' },
  // 3. Dates (except year) — MM/DD/YYYY, DD-MM-YYYY, etc.
  { name: 'date', regex: /\b(?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01])[\/\-.](?:19|20)\d{2}\b/g, replacement: '[DATE]' },
  { name: 'date_iso', regex: /\b(?:19|20)\d{2}[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01])\b/g, replacement: '[DATE]' },
  // 4. Phone / Fax
  { name: 'phone', regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[PHONE]' },
  // 5. Email
  { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '[EMAIL]' },
  // 6. SSN
  { name: 'ssn', regex: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, replacement: '[SSN]' },
  // 7. Medical record numbers (alphanumeric, 4–20 chars, often with MR/MRN prefix)
  { name: 'mrn', regex: /\b(?:MRN?|Medical Record|Chart)\s*[#:]?\s*[A-Za-z0-9]{4,20}\b/gi, replacement: '[MRN]' },
  // 8. Health plan beneficiary numbers
  { name: 'insurance', regex: /\b(?:Policy|Insurance|Member|Group|Subscriber)\s*(?:ID|Number|#)\s*[:#]?\s*[A-Za-z0-9-]{5,25}\b/gi, replacement: '[INSURANCE]' },
  // 9. Account numbers
  { name: 'account', regex: /\b(?:Account|Acct)\s*(?:#|Number|No)?\s*[:#]?\s*\d{5,}\b/gi, replacement: '[ACCOUNT]' },
  // 10. Certificate / licence numbers
  { name: 'license', regex: /\b(?:License|Lic|Certificate|Cert)\s*(?:#|Number)?\s*[:#]?\s*[A-Za-z0-9-]{4,20}\b/gi, replacement: '[LICENSE]' },
  // 11. Vehicle identifiers (VIN-style)
  { name: 'vin', regex: /\b[A-HJ-NPR-Z0-9]{17}\b/gi, replacement: '[VIN]' },
  // 12. Device identifiers
  { name: 'device', regex: /\b(?:Device|Serial|SN)\s*(?:#|Number)?\s*[:#]?\s*[A-Za-z0-9-]{6,}\b/gi, replacement: '[DEVICE]' },
  // 13. URLs
  { name: 'url', regex: /\bhttps?:\/\/[^\s]+/gi, replacement: '[URL]' },
  // 14. IP addresses
  { name: 'ip', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP]' },
  // 15. Biometric identifiers (simplified — common file extensions)
  { name: 'biometric', regex: /\b(?:fingerprint|retina|iris|voiceprint|facial scan|dna profile)\b/gi, replacement: '[BIOMETRIC]' },
  // 16. Full-face photos (filename references)
  { name: 'photo', regex: /\b(?:photo|image|picture|img)\s*[:#]?\s*[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|gif|bmp)\b/gi, replacement: '[PHOTO]' },
  // 17. Any other unique identifying number, characteristic, or code
  // (caught broadly by the above; we leave a catch-all for UUIDs)
  { name: 'uuid', regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replacement: '[UUID]' },
];

/**
 * De-identify a free-text string by replacing HIPAA identifiers with tokens.
 */
export function deidentifyText(text: string): string {
  let out = text;
  for (const p of PATTERNS) {
    out = out.replace(p.regex, p.replacement);
  }
  return out;
}

export interface DeidentifyResult {
  text: string;
  replacements: Array<{ category: string; count: number }>;
}

/**
 * De-identify text and return a summary of what was replaced.
 */
export function deidentifyWithReport(text: string): DeidentifyResult {
  const replacements: Array<{ category: string; count: number }> = [];
  let out = text;
  for (const p of PATTERNS) {
    const matches = out.match(p.regex);
    if (matches) {
      replacements.push({ category: p.name, count: matches.length });
      out = out.replace(p.regex, p.replacement);
    }
  }
  return { text: out, replacements };
}

/**
 * De-identify a simple object (record) by applying text rules to all string values.
 */
export function deidentifyRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'string') {
      out[k] = deidentifyText(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => (typeof item === 'string' ? deidentifyText(item) : item));
    } else {
      out[k] = v;
    }
  }
  return out;
}
