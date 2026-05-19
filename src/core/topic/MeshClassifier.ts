// Topic classifier — MeSH-subset dictionary mapped to anatomical regions.
// Lightweight keyword pass over streaming output; throttled in caller.
// Real MeSH data loaded from data/mesh-subset.json (Phase 5).

import type { RegionId } from '@config/agents';

interface MeshTerm {
  term: string;
  region: RegionId;
  weight: number;
}

// Tiny seed set; Phase 5 replaces this with a loaded JSON of ~1k terms.
const SEED_TERMS: MeshTerm[] = [
  { term: 'cardiology', region: 'brainstem', weight: 0.8 },
  { term: 'cardiac', region: 'brainstem', weight: 0.7 },
  { term: 'neurology', region: 'frontal', weight: 0.9 },
  { term: 'neural', region: 'frontal', weight: 0.8 },
  { term: 'pharmacology', region: 'basal_ganglia', weight: 0.85 },
  { term: 'drug', region: 'basal_ganglia', weight: 0.6 },
  { term: 'memory', region: 'hippocampus', weight: 0.9 },
  { term: 'imaging', region: 'occipital', weight: 0.8 },
  { term: 'mri', region: 'occipital', weight: 0.8 },
  { term: 'ct', region: 'occipital', weight: 0.7 },
  { term: 'pathology', region: 'temporal', weight: 0.7 },
  { term: 'oncology', region: 'temporal', weight: 0.75 },
  { term: 'motor', region: 'cerebellum', weight: 0.8 },
  { term: 'coordination', region: 'cerebellum', weight: 0.7 },
  { term: 'fear', region: 'amygdala', weight: 0.8 },
  { term: 'emotion', region: 'amygdala', weight: 0.7 },
  { term: 'attention', region: 'parietal', weight: 0.8 },
  { term: 'sensation', region: 'parietal', weight: 0.7 },
  { term: 'thalamus', region: 'thalamus', weight: 1.0 },
];

export function classify(text: string): { region: RegionId; confidence: number; term: string }[] {
  const lc = text.toLowerCase();
  const hits: { region: RegionId; confidence: number; term: string }[] = [];
  for (const t of SEED_TERMS) {
    if (lc.includes(t.term)) {
      hits.push({ region: t.region, confidence: t.weight, term: t.term });
    }
  }
  return hits;
}
