// Live swarm panel — the boss and the five topic specialists with their
// per-run state. Replaces the old static medical-source list: this window
// reflects the agents the boss actually assigned and how each is doing.

import { memo } from 'react';
import { agentById, AGENTS, type AgentId } from '@config/agents';
import { regionById } from '../data/regions';
import { Icon, type IconName } from '@ui/icons';

export type AgentRunState = 'idle' | 'running' | 'done' | 'error';

export interface AgentStatus {
  agentId: AgentId;
  label: string;
  kind: 'boss' | 'specialist';
  state: AgentRunState;
  detail?: string;
}

const STATE_ICON: Record<AgentRunState, IconName> = {
  idle: 'pulse',
  running: 'spinner',
  done: 'check',
  error: 'alert',
};

function fallbackDetail(agent: AgentStatus): string {
  if (agent.detail) return agent.detail;
  if (agent.state === 'running') return agent.kind === 'boss' ? 'routing and synthesizing' : 'fetching source evidence';
  if (agent.state === 'done') return agent.kind === 'boss' ? 'synthesis complete' : 'evidence stored';
  if (agent.state === 'error') return 'needs attention';
  return agent.kind === 'boss' ? 'ready to route' : 'standing by';
}

// Every agent starts idle. The boss + specialists are listed boss-first.
export const initialAgentStatuses = (): AgentStatus[] =>
  AGENTS.map((agent) => ({
    agentId: agent.id,
    label: agent.label,
    kind: agent.kind,
    state: 'idle' as AgentRunState,
  }));

export const AgentPanel = memo(function AgentPanel({ statuses }: { statuses: AgentStatus[] }) {
  const activeCount = statuses.filter((status) => status.state === 'running').length;
  const doneCount = statuses.filter((status) => status.state === 'done').length;
  const errorCount = statuses.filter((status) => status.state === 'error').length;

  return (
    <section className="agent-panel" aria-label="Agent swarm status">
      <header>
        <div className="agent-panel-title">
          <h3>
            <Icon name="agent" size={12} /> Agent swarm
          </h3>
          <p>Boss routing with five specialist source agents.</p>
        </div>
        <div className="agent-panel-metrics" aria-label="Agent run counters">
          <span data-tone={activeCount > 0 ? 'active' : 'idle'}>{activeCount} active</span>
          <span>{doneCount} done</span>
          {errorCount > 0 && <span data-tone="error">{errorCount} error</span>}
        </div>
      </header>
      <ul>
        {statuses.map((agent) => {
          const definition = agentById(agent.agentId);
          const color = regionById(definition.regionBinding).emissive;
          return (
            <li key={agent.agentId} data-state={agent.state} data-kind={agent.kind}>
              <span className="agent-swatch" style={{ background: color }} aria-hidden="true" />
              <div className="agent-row">
                <span className="agent-row-head">
                  <strong>{agent.label}</strong>
                  <span className="agent-role">{agent.kind === 'boss' ? 'Boss' : 'Specialist'}</span>
                  <span className="agent-state-icon" data-state={agent.state} aria-hidden="true">
                    <Icon name={STATE_ICON[agent.state]} size={12} />
                  </span>
                </span>
                <span className="agent-row-detail">{fallbackDetail(agent)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
