// Drug-Interactions mode — its own sidebar tab. It reuses the Brain chat
// experience but routes every question to a single drug-interaction specialist
// that returns a focused, cited interaction report (see runSwarm's drugFocus
// path). The heavy 3D brain canvas is skipped in this mode.

import { BrainMode } from './BrainMode';

export default function DrugInteractionsMode() {
  return <BrainMode drugFocus />;
}
