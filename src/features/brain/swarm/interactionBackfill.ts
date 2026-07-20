// Drug-interaction backfill for the paper path.
//
// A research/paper request can embed a drug-interaction sub-question ("compare
// … and note the rivaroxaban + catafast interaction"). Because the query routes
// to the manuscript pipeline as a single intent, the dedicated drug-interaction
// path never runs, and the paper wrongly concludes "no interaction data were
// retrieved" for a real, safety-relevant interaction.
//
// This pass detects that sub-request (an interaction cue plus ≥2 recognized
// drugs) and fetches the interaction literature under the drugs' GENERIC names,
// returning a synthetic specialist result the caller merges into the paper's
// evidence. It is deterministic (a bounded PubMed fetch), best-effort (a failure
// never breaks the run), and additive — the paper cites real interaction records
// instead of declaring a gap. No separate verdict card is produced.

import { tools as toolRegistry } from '@core/tools/ToolRegistry';
import type { EvidenceItem, MedicalSourceResult } from '@platform/index';
import type { SpecialistResult, SwarmCallbacks } from './types';
import { drugCandidates } from './boss';
import { primaryGeneric } from './drugAliases';
import { hasInteractionCue } from './intent';

/** The generic ingredient a token should be searched under — the brand's single
 *  active ingredient ("catafast" → "diclofenac"), else the token itself. */
function searchNameFor(drug: string): string {
  return primaryGeneric(drug);
}

/** A factual identity line for any brand in the pair, threaded into the drafting
 *  context so the manuscript refers to each drug by its real active ingredient
 *  rather than inventing one. A real run wrote "clindamycin (Klacid)" — Klacid is
 *  clarithromycin — because the paper model never saw the registry mapping. */
export function drugIdentityNote(a: string, b: string): string {
  const ids = [a, b]
    .map((drug) => {
      const generic = primaryGeneric(drug);
      return generic && generic.toLowerCase() !== drug.toLowerCase() ? `${drug} = ${generic}` : null;
    })
    .filter((entry): entry is string => entry !== null);
  return ids.length
    ? `Drug identities from the pharmacy registry — refer to each drug by this exact active ingredient, never a different drug name: ${ids.join('; ')}.`
    : '';
}

/**
 * The drug pair an interaction sub-request names, or null when the text carries
 * no interaction cue or fewer than two recognized drugs. Pure and deterministic
 * so the routing decision is testable without the network.
 */
export function interactionDrugPair(question: string): [string, string] | null {
  if (!hasInteractionCue(question)) return null;
  const drugs = drugCandidates(question);
  if (drugs.length < 2) return null;
  return [drugs[0]!, drugs[1]!];
}

/**
 * Fetch interaction literature for a drug pair a paper request also asks about,
 * so the manuscript reflects real interaction evidence rather than a false gap.
 * Returns a synthetic specialist result (null when there is no interaction
 * sub-request, or nothing was found).
 */
export async function backfillDrugInteractions(
  question: string,
  callbacks: SwarmCallbacks,
  opts: { maxPerQuery?: number } = {},
): Promise<SpecialistResult | null> {
  const pair = interactionDrugPair(question);
  if (!pair) return null;
  const pubmed = toolRegistry.get('pubmed_search');
  if (!pubmed) return null;

  const maxPerQuery = opts.maxPerQuery ?? 3;
  const [a, b] = pair;
  const genericA = searchNameFor(a);
  const genericB = searchNameFor(b);
  // Search under the generic names (real literature is indexed there), and under
  // the named terms as written in case they are already generic.
  const queries = [...new Set([`${genericA} ${genericB} interaction`, `${a} ${b} drug interaction`])];

  const records: EvidenceItem[] = [];
  let toolCalls = 0;
  callbacks.onToolCall('pharmacist', `Drug interaction: ${a} + ${b}`);
  for (const query of queries) {
    try {
      const result = await pubmed.execute({ query, maxResults: maxPerQuery });
      toolCalls += 1;
      const recs = (result as MedicalSourceResult | undefined)?.results ?? [];
      records.push(...recs);
      callbacks.onToolResult('pharmacist', `interaction: ${query}`, recs.length);
    } catch {
      /* best-effort — a failed interaction fetch never breaks the paper run */
    }
  }
  if (records.length === 0) return null;
  return {
    agentId: 'pharmacist',
    label: 'Drug interaction literature',
    subQuery: `interaction evidence for ${a} + ${b}`,
    findings: drugIdentityNote(a, b),
    evidence: records,
    toolCalls,
  };
}
