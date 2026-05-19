import { AgentBase } from '@agents/core/AgentBase';

export class Critic extends AgentBase {
  constructor() {
    super({
      agentId: 'critic',
      regionBinding: 'amygdala',
      llmProviderId: 'anthropic',
      systemPrompt:
        'You are Critic. Audit a draft synthesis for ungrounded claims, mis-cited sources, and evidence-hierarchy violations (e.g., case report cited where RCT is needed). Flag every problem with reasoning.',
      tools: [],
    });
  }
}
