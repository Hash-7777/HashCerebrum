// Typed event surface. EventBus.emit/on use these types — no string drift.
// This keeps renderer-to-core events on a typed channel.

import type { AgentId, RegionId } from '@config/agents';
import type { ModeId } from '@config/modes';

export interface AuditEntry {
  seq: number;
  ts: string;
  category: string;
  subject: string;
  action: string;
  data_hash: string;
  prev_hash: string;
  entry_hash: string;
}

export interface RegionLightEvent {
  region: RegionId;
  source: 'agent' | 'topic';
  agentId?: AgentId;
  intensity: number; // 0..1
  ttlMs: number;
}

export interface AgentActivityEvent {
  agentId: AgentId | 'system';
  phase: 'start' | 'tool_call' | 'tool_result' | 'token' | 'done' | 'error';
  detail?: string;
  light?: {
    intensity?: number;
    ttlMs?: number;
  };
}

export interface TopicEvent {
  region: RegionId;
  confidence: number;
  term: string;
}

export interface ModeChangeEvent {
  from: ModeId;
  to: ModeId;
}

export interface BlackboardUpdateEvent {
  runId: string;
  entry: { id: string; type: string; title: string };
}

export interface BlackboardClearedEvent {
  runId: string;
}

export interface ConsensusVoteEvent {
  runId: string;
  agentId: string;
  evidenceHash: string;
  confidence: number;
}

export interface TelemetrySpanEvent {
  traceId: string;
  name: string;
  status: string;
}

export type EventMap = {
  'region:light': RegionLightEvent;
  'agent:activity': AgentActivityEvent;
  'topic:detected': TopicEvent;
  'mode:change': ModeChangeEvent;
  'blackboard:updated': BlackboardUpdateEvent;
  'blackboard:cleared': BlackboardClearedEvent;
  'consensus:vote': ConsensusVoteEvent;
  'telemetry:span': TelemetrySpanEvent;
};
