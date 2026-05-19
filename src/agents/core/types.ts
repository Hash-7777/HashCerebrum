import type { AgentId, RegionId } from '@config/agents';
import type { LlmMessage, LlmProviderId } from '@core/llm/types';

export interface AgentContext {
  agentId: AgentId;
  regionBinding: RegionId;
  llmProviderId: LlmProviderId;
  systemPrompt: string;
  tools: string[]; // tool names this agent is allowed to call
}

export interface AgentTurn {
  input: LlmMessage[];
  maxIterations?: number;
}

export interface AgentOutput {
  finalMessage: string;
  toolCallCount: number;
  durationMs: number;
}
