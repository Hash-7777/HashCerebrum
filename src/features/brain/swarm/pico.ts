// Deterministic PICO extraction. A clinical question breaks into
// Population / Intervention / Comparator / Outcome — the frame a systematic review
// is built on. Pulling these out (with cue words, no model) lets the app show the
// structured question it is answering, and could later sharpen the search terms.
//
// Heuristic by design: it recognises well-formed clinical phrasings and returns
// null for any slot it cannot fill. It never throws.

export interface Pico {
  population: string | null;
  intervention: string | null;
  comparator: string | null;
  outcome: string | null;
}

function clean(s: string | undefined): string | null {
  if (!s) return null;
  const out = s
    .replace(/[.?!,;:]+$/, '')
    .replace(/\b(the|a|an)\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length >= 2 ? out : null;
}

export function extractPico(question: string): Pico {
  const q = question.trim();

  // Comparator — "versus / vs / compared with / against X".
  const cmp = q.match(/\b(?:versus|vs\.?|compared (?:to|with)|against)\s+([a-z0-9][\w-]*(?:\s+[a-z0-9][\w-]*){0,4})/i);

  // Outcome — an explicit "risk of / effect on / incidence of X", else a bare
  // outcome noun.
  const outPhrase = q.match(
    /\b(?:risk of|effect(?:s)? on|incidence of|impact on|association with|rate of|prevention of|reduction in)\s+([a-z0-9][\w-]*(?:\s+[a-z0-9][\w-]*){0,4})/i,
  );
  const outWord = q.match(
    /\b(mortality|survival|death|bleeding|stroke|recurrence|remission|readmission|adverse events?|cardiovascular events?|disease progression)\b/i,
  );

  // Population — "in <adults/patients/…> with <condition>".
  const pop = q.match(
    /\bin\s+((?:adults?|older adults?|elderly|p(?:a?)ediatric|children|child|women|men|patients?|people|neonates?|infants?)(?:\s+with\s+[a-z0-9][\w-]*(?:\s+[a-z0-9][\w-]*){0,4})?)/i,
  );

  // Intervention — "efficacy/use/role of X", "treatment with X", or "does X …".
  const ivOf = q.match(
    /\b(?:efficacy|safety|effect|role|use|benefit|impact)\s+of\s+([a-z0-9][\w-]*(?:\s+[a-z0-9][\w-]*){0,3}?)(?=\s+(?:in|for|on|versus|vs|compared|to reduce|$))/i,
  );
  const ivWith = q.match(/\b(?:treatment|therapy|treated)\s+with\s+([a-z0-9][\w-]*(?:\s+[a-z0-9][\w-]*){0,3})/i);
  const ivDoes = q.match(
    /\bdoes\s+([a-z0-9][\w-]*(?:\s+[a-z0-9][\w-]*){0,2}?)\s+(?:compared|versus|vs|reduce|improve|increase|decrease|affect|lower|raise|prevent|cause)/i,
  );

  return {
    population: clean(pop?.[1]),
    intervention: clean(ivOf?.[1] ?? ivWith?.[1] ?? ivDoes?.[1]),
    comparator: clean(cmp?.[1]),
    outcome: clean(outPhrase?.[1] ?? outWord?.[0]),
  };
}

/** A one-line human-readable PICO summary, or '' when nothing was extracted. */
export function picoSummary(pico: Pico): string {
  const parts: string[] = [];
  if (pico.population) parts.push(`Population: ${pico.population}`);
  if (pico.intervention) parts.push(`Intervention: ${pico.intervention}`);
  if (pico.comparator) parts.push(`Comparator: ${pico.comparator}`);
  if (pico.outcome) parts.push(`Outcome: ${pico.outcome}`);
  return parts.join(' · ');
}

/** True when at least two PICO slots are filled — enough to be worth showing. */
export function isPicoUseful(pico: Pico): boolean {
  return Object.values(pico).filter(Boolean).length >= 2;
}
