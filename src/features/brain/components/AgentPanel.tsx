import { memo } from 'react';
import { agentById, BRAIN_AGENTS, type AgentId } from '@config/agents';
import { regionById } from '../data/regions';

export type AgentRunState = 'idle' | 'running' | 'done' | 'error';

export interface AgentStatus {
  agentId: AgentId;
  label: string;
  kind: 'boss' | 'specialist';
  state: AgentRunState;
  detail?: string;
}

function fallbackDetail(agent: AgentStatus): string {
  if (agent.detail) return agent.detail;
  if (agent.state === 'running') return agent.kind === 'boss' ? 'routing' : 'fetching';
  if (agent.state === 'done') return agent.kind === 'boss' ? 'synthesis done' : 'evidence stored';
  if (agent.state === 'error') return 'error';
  return '—';
}

export const initialAgentStatuses = (): AgentStatus[] =>
  BRAIN_AGENTS.map((agent) => ({
    agentId: agent.id,
    label: agent.label,
    kind: agent.kind,
    state: 'idle' as AgentRunState,
  }));

function AgentMark({ state }: { state: AgentRunState }) {
  return <span className={`ag-mark ${state}`} aria-hidden="true" />;
}

export const AgentPanel = memo(function AgentPanel({ statuses }: { statuses: AgentStatus[] }) {
  const activeCount = statuses.filter((s) => s.state === 'running').length;
  const doneCount   = statuses.filter((s) => s.state === 'done').length;
  const total       = statuses.length;
  const progress    = total > 0 ? ((activeCount + doneCount) / total) * 100 : 0;
  const isActive    = activeCount > 0;

  return (
    <div className="swarm" aria-label="Agent swarm status">
      <div className="swarm-head">
        <div className="swarm-label">Agent Swarm</div>
        <div className="swarm-live">
          {isActive && <span className="swarm-active-dot" aria-hidden="true" />}
          <span className="swarm-active-count">
            {isActive ? `${activeCount} active` : doneCount > 0 ? 'done' : 'idle'}
          </span>
          <span className="swarm-progress-frac">{activeCount + doneCount}/{total}</span>
        </div>
      </div>

      <div className="swarm-progress-bar">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="swarm-table">
        {statuses.map((agent) => {
          const definition = agentById(agent.agentId);
          const region     = regionById(definition.regionBinding);
          return (
            <div key={agent.agentId} className={`swarm-row ${agent.state}`}>
              <AgentMark state={agent.state} />
              <div className="ag-info">
                <div className="ag-name">{agent.label}</div>
                <div className="ag-domain" style={{ color: region.emissive }}>
                  {agent.kind === 'boss' ? 'Orchestrator' : 'Specialist'}
                </div>
              </div>
              <div className="ag-output">{fallbackDetail(agent)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
