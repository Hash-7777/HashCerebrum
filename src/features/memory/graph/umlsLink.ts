// UMLS / SNOMED CT Entity Linking — query UMLS API for medical entities
// and link memory graph nodes to canonical CUIs and SNOMED CT IDs.
// This is a scaffolding module; live UMLS API calls require an API key
// and are gated behind the existing security::guard.

export interface UmlsEntity {
  cui: string;
  name: string;
  semanticType: string;
  snomedCtId?: string;
  confidence: number;
}

const entityCache = new Map<string, UmlsEntity[]>();

/**
 * Extract candidate medical terms from evidence text (simplified regex-based).
 * In production this would call a clinical NER model or the UMLS MetaMap API.
 */
export function extractCandidateTerms(text: string): string[] {
  // Simplified: look for capitalised multi-word phrases that could be diseases,
  // drugs, or procedures. This is intentionally conservative.
  const matches = text.match(/\b(?:[A-Z][a-z]+(?:\s+)?){2,5}\b/g);
  return [...new Set(matches ?? [])];
}

/**
 * Mock UMLS lookup for browser dev and testing.
 * In the desktop app, this calls the UMLS API via a Rust command.
 */
export async function queryUmls(term: string): Promise<UmlsEntity[]> {
  const cached = entityCache.get(term);
  if (cached) return cached;

  // Mock response for offline development
  const mock: UmlsEntity[] = [
    {
      cui: `C${Math.floor(Math.random() * 900000 + 100000)}`,
      name: term,
      semanticType: 'Disease or Syndrome',
      confidence: 0.85,
    },
  ];

  entityCache.set(term, mock);
  return mock;
}

/**
 * Link a corpus of texts to UMLS entities.
 */
export async function linkCorpus(texts: string[]): Promise<Map<string, UmlsEntity[]>> {
  const results = new Map<string, UmlsEntity[]>();
  for (const text of texts) {
    const terms = extractCandidateTerms(text);
    const all: UmlsEntity[] = [];
    for (const term of terms.slice(0, 5)) {
      const entities = await queryUmls(term);
      all.push(...entities);
    }
    results.set(text.slice(0, 60), all);
  }
  return results;
}
