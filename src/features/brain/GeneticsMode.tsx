// Genetics mode — its own sidebar tab. It reuses the Brain chat experience but
// routes every question to the gene-expert specialist, which clarifies the query
// if needed and returns a gene-variant ↔ disease correlation report with an
// app-computed association-confidence score (see runSwarm's geneticsFocus path).
// The 3D brain canvas is skipped in this mode.

import { BrainMode } from './BrainMode';

export default function GeneticsMode() {
  return <BrainMode geneticsFocus />;
}
