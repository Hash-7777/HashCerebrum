// Medical sources surfaced in the Brain workspace, mapped to the agent
// and brain region that each one lights up when it runs.

import type { AgentId, RegionId } from '@config/agents';
import type { EvidenceItem } from '@platform/index';
import type { IconName } from '@ui/icons';

export interface SourceDef {
  id: EvidenceItem['source'];
  label: string;
  tool: string;
  agentId: AgentId;
  region: RegionId;
  icon: IconName;
}

// Each medical source is owned by the topic specialist that queries it, so
// running a tool lights that specialist's brain region.
export const SOURCE_DEFS: SourceDef[] = [
  { id: 'pubmed', label: 'PubMed', tool: 'pubmed_search', agentId: 'literature', region: 'hippocampus', icon: 'book' },
  { id: 'europepmc', label: 'Europe PMC', tool: 'europepmc_fetch', agentId: 'literature', region: 'hippocampus', icon: 'book' },
  { id: 'openalex', label: 'OpenAlex', tool: 'openalex_query', agentId: 'literature', region: 'hippocampus', icon: 'database' },
  { id: 'ctgov', label: 'ClinicalTrials.gov', tool: 'ctgov_search', agentId: 'trials', region: 'parietal', icon: 'trial' },
  { id: 'openfda', label: 'OpenFDA', tool: 'openfda_query', agentId: 'pharmacology', region: 'basal_ganglia', icon: 'pill' },
  { id: 'rxnorm', label: 'RxNorm', tool: 'rxnorm_lookup', agentId: 'pharmacology', region: 'basal_ganglia', icon: 'flask' },
];
