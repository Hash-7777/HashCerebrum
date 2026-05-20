// Shared types for the boss-swarm research engine: the boss decomposes a
// question, topic specialists research their angle in parallel, and the
// boss synthesizes one cited answer.

import type { AgentId } from '@config/agents';
import type { EvidenceItem } from '@platform/index';
import type { LlmMessage } from '@core/llm/types';

export interface SpecialistTask {
  agentId: AgentId;
  subQuery: string;
}

export interface SpecialistResult {
  agentId: AgentId;
  label: string;
  subQuery: string;
  findings: string;
  evidence: EvidenceItem[];
  toolCalls: number;
  error?: string;
}

export type BossPhase = 'routing' | 'delegating' | 'synthesizing' | 'answering';

export interface SwarmCallbacks {
  onBossPhase: (phase: BossPhase) => void;
  onSpecialistStart: (agentId: AgentId, subQuery: string) => void;
  onSpecialistDone: (agentId: AgentId, recordCount: number) => void;
  onSpecialistError: (agentId: AgentId, message: string) => void;
  onToolCall: (agentId: AgentId, toolName: string) => void;
  onToolResult: (agentId: AgentId, toolName: string, count: number) => void;
  onAnswerToken: (delta: string) => void;
}

export interface SwarmResult {
  kind: 'chat' | 'research';
  answer: string;
  evidence: EvidenceItem[];
  specialists: SpecialistResult[];
  modelUsed: string;
}

export interface SwarmOptions {
  question: string;
  // Prior conversation turns (user/assistant only, no system message).
  conversation: LlmMessage[];
  // Resolves the LLM model each agent runs on.
  modelFor: (agentId: AgentId) => string;
  callbacks: SwarmCallbacks;
}
