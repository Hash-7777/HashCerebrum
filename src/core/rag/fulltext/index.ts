// Open-access full-text service. Given an Europe PMC source code + id, fetch the
// article's full text (plain text, tags already stripped in Rust) and clean it
// with the same text normaliser used for imported PDFs.
//
// It is fail-safe by design: any failure — no open-access full text, not running
// in the desktop app, a network error — resolves to null, and the caller keeps
// using the abstract (today's behaviour). So this only ever ADDS depth.

import { platform } from '@platform/index';
import { cleanPdfText } from '../ingest/pdfImport';

export interface FullTextRef {
  /** Europe PMC source code, e.g. "PMC" (with a PMCID) or "MED" (with a PMID). */
  source: string;
  id: string;
}

/** Fetch + clean the open-access full text, or null when unavailable. */
export async function fetchFullText(ref: FullTextRef): Promise<string | null> {
  const source = ref.source.trim();
  const id = ref.id.trim();
  if (!source || !id) return null;
  try {
    const raw = await platform().medical.europepmcFulltext(source, id);
    const cleaned = cleanPdfText(raw);
    return cleaned.trim().length > 0 ? cleaned : null;
  } catch {
    // No open-access full text, or not on desktop → fall back to the abstract.
    return null;
  }
}
