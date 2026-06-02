// A per-run memory domain scope for the rag_search tool. The Drug-Interactions
// run sets this to 'drug_interactions' around its specialist call so memory
// retrieval returns ONLY that mode's own trusted findings — it is never fed by
// other modes' saved research. Other runs leave it null and read the whole
// library (so they still benefit from the drug-interaction findings).

let scope: string | null = null;

export function setMemoryScope(tag: string | null): void {
  scope = tag;
}

export function getMemoryScope(): string | null {
  return scope;
}
