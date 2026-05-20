// Live swarm panel — the boss and the five topic specialists with their
// per-run state. Replaces the old static medical-source list: this window
// reflects the agents the boss actually assigned and how each is doing.

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

// Every agent starts idle. The boss + specialists are listed boss-first.
export const initialAgentStatuses = (): AgentStatus[] =>
  AGENTS.map((agent) => ({
    agentId: agent.id,
    label: agent.label,
    kind: agent.kind,
    state: 'idle' as AgentRunState,
  }));

export function AgentPanel({ statuses }: { statuses: AgentStatus[] }) {
  const activeCount = statuses.filter((status) => status.state === 'running').length;

  return (
    <section className="agent-panel" aria-label="Agent swarm status">
      <header>
        <h3>
          <Icon name="agent" size={12} /> Agent swarm
        </h3>
        <span>{activeCount} active</span>
      </header>
      <ul>
        {statuses.map((agent) => {
          const color = regionById(agentById(agent.agentId).regionBinding).emissive;
          return (
            <li key={agent.agentId} data-state={agent.state} data-kind={agent.kind}>
              <span className="agent-swatch" style={{ background: color }} aria-hidden="true" />
              <div className="agent-row">
                <span className="agent-row-head">
                  <strong>{agent.label}</strong>
                  <span className="agent-state-icon" data-state={agent.state} aria-hidden="true">
                    <Icon name={STATE_ICON[agent.state]} size={12} />
                  </span>
                </span>
                <span className="agent-row-detail">{agent.detail ?? agent.state}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
