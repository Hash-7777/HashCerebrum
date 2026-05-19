import { AgentBase } from '@agents/core/AgentBase';

export class Citation extends AgentBase {
  constructor() {
    super({
      agentId: 'citation',
      regionBinding: 'occipital',
      llmProviderId: 'anthropic',
      systemPrompt:
        'You are Citation. Convert source identifiers (PMID/DOI/NCT) into BibTeX and CSL-JSON. Verify metadata accuracy.',
      tools: [],
    });
  }
}
