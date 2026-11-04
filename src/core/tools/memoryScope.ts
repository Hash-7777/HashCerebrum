// A per-run memory domain scope for the rag_search tool. A drug-interaction run
// sets this to 'drug_interactions' around its specialist call so memory
// retrieval returns ONLY drug-interaction findings — it is never fed by general
// saved research. Other runs leave it null and read the whole
// library (so they still benefit from the drug-interaction findings).
//
// RAG-004 fix: replaced the mutable module-global with a stack so concurrent
// runs cannot overwrite each other's scope.

const scopeStack: (string | null)[] = [];

export function setMemoryScope(tag: string | null): void {
  scopeStack.push(tag);
}

export function clearMemoryScope(): void {
  scopeStack.pop();
}

export function getMemoryScope(): string | null {
  if (scopeStack.length === 0) return null;
  return scopeStack[scopeStack.length - 1] ?? null;
}
