// Medical sources surfaced in the Brain workspace, mapped to the agent
// and brain region that each one lights up when it runs.

import type { AgentId, RegionId } from '@config/agents';
import { SOURCE_DOMAIN } from '@config/sourceRegions';
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
  { id: 'pubmed', label: 'PubMed', tool: 'pubmed_search', agentId: SOURCE_DOMAIN['pubmed']!.agentId, region: SOURCE_DOMAIN['pubmed']!.region, icon: 'book' },
  { id: 'europepmc', label: 'Europe PMC', tool: 'europepmc_fetch', agentId: SOURCE_DOMAIN['europepmc']!.agentId, region: SOURCE_DOMAIN['europepmc']!.region, icon: 'book' },
  { id: 'openalex', label: 'OpenAlex', tool: 'openalex_query', agentId: SOURCE_DOMAIN['openalex']!.agentId, region: SOURCE_DOMAIN['openalex']!.region, icon: 'database' },
  { id: 'ctgov', label: 'ClinicalTrials.gov', tool: 'ctgov_search', agentId: SOURCE_DOMAIN['ctgov']!.agentId, region: SOURCE_DOMAIN['ctgov']!.region, icon: 'trial' },
  { id: 'openfda', label: 'OpenFDA', tool: 'openfda_query', agentId: SOURCE_DOMAIN['openfda']!.agentId, region: SOURCE_DOMAIN['openfda']!.region, icon: 'pill' },
  { id: 'rxnorm', label: 'RxNorm', tool: 'rxnorm_lookup', agentId: SOURCE_DOMAIN['rxnorm']!.agentId, region: SOURCE_DOMAIN['rxnorm']!.region, icon: 'flask' },
  { id: 'gwas_catalog', label: 'GWAS Catalog', tool: 'gwas_catalog_search', agentId: SOURCE_DOMAIN['gwas_catalog']!.agentId, region: SOURCE_DOMAIN['gwas_catalog']!.region, icon: 'dna' },
  { id: 'clinvar', label: 'ClinVar', tool: 'clinvar_search', agentId: SOURCE_DOMAIN['clinvar']!.agentId, region: SOURCE_DOMAIN['clinvar']!.region, icon: 'dna' },
];
