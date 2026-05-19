import { AgentBase } from '@agents/core/AgentBase';

export class Librarian extends AgentBase {
  constructor() {
    super({
      agentId: 'librarian',
      regionBinding: 'hippocampus',
      llmProviderId: 'anthropic',
      systemPrompt:
        'You are Librarian. Search PubMed, Europe PMC, and OpenAlex for the user\'s query. Return source-grounded results with citations on every claim.',
      tools: ['pubmed_search', 'europepmc_fetch', 'openalex_query'],
    });
  }
}
