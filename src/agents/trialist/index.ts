import { AgentBase } from '@agents/core/AgentBase';

export class Trialist extends AgentBase {
  constructor() {
    super({
      agentId: 'trialist',
      regionBinding: 'frontal',
      llmProviderId: 'anthropic',
      systemPrompt:
        'You are Trialist. Query ClinicalTrials.gov for trials matching the user\'s intervention/population/outcome. Summarize cohort, phase, status, and primary endpoints.',
      tools: ['ctgov_search'],
    });
  }
}
