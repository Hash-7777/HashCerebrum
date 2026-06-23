/**
 * Opt-in diagnostics for the agentic RAG. The closed-loop signals (learned
 * priors, gap re-retrieval, recalled beliefs, consensus, autonomous study) flow
 * to the answering model, not the UI, so they are normally invisible. This logs
 * them to the console ONLY when explicitly enabled, so a developer can watch the
 * loop work without ever touching shipped behaviour.
 *
 * Enable in the app's devtools console:  localStorage.setItem('hc.debug.rag','1')
 * Disable:                               localStorage.removeItem('hc.debug.rag')
 *
 * Off by default everywhere (production, tests) — a no-op unless the flag is set.
 */

export function ragDebugEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('hc.debug.rag') === '1';
  } catch {
    return false;
  }
}

export function ragDebug(label: string, data: Record<string, unknown>): void {
  if (!ragDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(`%c[RAG] ${label}`, 'color:#6ea8fe;font-weight:bold', data);
}
