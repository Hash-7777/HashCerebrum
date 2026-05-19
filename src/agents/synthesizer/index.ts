import { AgentBase } from '@agents/core/AgentBase';

export class Synthesizer extends AgentBase {
  constructor() {
    super({
      agentId: 'synthesizer',
      regionBinding: 'parietal',
      llmProviderId: 'anthropic',
      systemPrompt:
        'You are Synthesizer. Given source-grounded notes, produce a PICO-framed synthesis with GRADE-style evidence ratings. Cite every claim.',
      tools: [],
    });
  }
}
