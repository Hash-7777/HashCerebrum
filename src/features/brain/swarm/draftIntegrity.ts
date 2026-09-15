// Checks run on a drafted section before it is kept: an identifier the prose
// cites must belong to a record the pipeline actually retrieved, and each claim
// should still read like the evidence it cites.
//
// Pure and model-free, so they run on every section on every provider — the
// rate-limited free-tier path included, which is where a hallucinated trial
// number is most likely to appear.

import type { EvidenceItem } from '@platform/index';

// ── C3: validate identifiers in draft prose ─────────────────────────────────
// Scan drafted text for PMID / DOI / NCT tokens and flag any that do not
// appear in the retrieved evidence set — prevents hallucinated citations.
export function validateDraftIdentifiers(
  text: string,
  evidence: EvidenceItem[],
): string[] {
  const issues: string[] = [];
  const pmids = new Set(evidence.map((e) => e.identifiers?.pmid).filter(Boolean));
  const dois = new Set(evidence.map((e) => e.identifiers?.doi).filter(Boolean));
  const ncts = new Set(evidence.map((e) => e.identifiers?.nct).filter(Boolean));

  for (const m of text.matchAll(/\bPMID:\s*(\d+)\b/gi)) {
    if (!pmids.has(m[1])) issues.push(`PMID:${m[1]}`);
  }
  for (const m of text.matchAll(/\bDOI:\s*([\S]+)\b/gi)) {
    if (!dois.has(m[1])) issues.push(`DOI:${m[1]}`);
  }
  for (const m of text.matchAll(/\b(NCT\d{8,})\b/gi)) {
    if (!ncts.has(m[1])) issues.push(m[1]!);
  }
  return issues;
}

// Remove trial-registry identifiers the draft cited that are NOT in the retrieved
// evidence — a hallucinated NCT presented as a real registered trial is a serious
// integrity failure ("the completed clinical trial registered as NCT03596502…"
// where no such record was retrieved). We strip the fabricated identifier and the
// "registered as / (NCT…)" scaffolding around it, leaving the surrounding prose,
// rather than assert a registry number the pipeline never saw. Verified NCTs (in
// evidence) are untouched.
export function neutralizeUnverifiableNct(text: string, badNcts: string[]): string {
  let out = text;
  for (const nct of badNcts) {
    const esc = nct.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      // "(NCT123…)" or ", NCT123…," parenthetical/apposition
      .replace(new RegExp(`\\s*[(\\[]\\s*${esc}\\s*[)\\]]`, 'gi'), '')
      // "registered as/under NCT123…", "identifier NCT123…", "NCT number NCT123…"
      .replace(new RegExp(`\\b(?:registered|identified|listed)\\s+(?:as|under)\\s+${esc}\\b`, 'gi'), 'a registered trial')
      .replace(new RegExp(`\\b(?:trial|study|registry)\\s+(?:number|identifier|id)\\s+${esc}\\b`, 'gi'), 'trial')
      // bare token
      .replace(new RegExp(`\\b${esc}\\b`, 'gi'), '');
  }
  return out
    .replace(/\s*,\s*,/g, ',')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:)])/g, '$1')
    .trim();
}

// ── C6: claim↔source fidelity gate ──────────────────────────────────────────
// Simple keyword overlap between a claim and its supporting source texts.
// Flags claims whose wording drifts far from the evidence they cite.
export function claimSourceFidelity(
  claim: string,
  sourceTexts: string[],
): { score: number; flag: boolean } {
  const claimWords = new Set(
    claim.toLowerCase().split(/\W+/).filter((w) => w.length > 3),
  );
  if (claimWords.size === 0) return { score: 0, flag: true };
  let bestOverlap = 0;
  for (const text of sourceTexts) {
    const textWords = new Set(
      text.toLowerCase().split(/\W+/).filter((w) => w.length > 3),
    );
    let overlap = 0;
    for (const w of claimWords) {
      if (textWords.has(w)) overlap++;
    }
    bestOverlap = Math.max(bestOverlap, overlap / claimWords.size);
  }
  return { score: bestOverlap, flag: bestOverlap < 0.15 };
}
