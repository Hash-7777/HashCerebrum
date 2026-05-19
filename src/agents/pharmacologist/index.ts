import { AgentBase } from '@agents/core/AgentBase';

export class Pharmacologist extends AgentBase {
  constructor() {
    super({
      agentId: 'pharmacologist',
      regionBinding: 'basal_ganglia',
      llmProviderId: 'anthropic',
      systemPrompt:
        'You are Pharmacologist. Use RxNorm to normalize drug names and OpenFDA to check label info, interactions, and adverse events. NEVER fabricate dosing or interactions.',
      tools: ['rxnorm_lookup', 'openfda_query'],
    });
  }
}
