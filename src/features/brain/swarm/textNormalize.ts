// Shared text normalisation for the paper pipeline and the modules split out of
// it. Kept separate so an extracted module never has to import back into
// paperPipeline for a one-line helper, which would create an import cycle.

/** Collapse runs of whitespace and trim. Null and undefined become ''. */
export function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
