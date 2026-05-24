import { memo } from 'react';
import { agentById, AGENTS, type AgentId } from '@config/agents';
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
  AGENTS.map((agent) => ({
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
  const doneCount = statuses.filter((s) => s.state === 'done').length;
  const idleCount = statuses.filter((s) => s.state === 'idle').length;
  const total = statuses.length;
  const progress = total > 0 ? ((activeCount + doneCount) / total) * 100 : 0;

  return (
    <div className="swarm" aria-label="Agent swarm status">
      <div className="swarm-head">
        <div className="swarm-label">Agent swarm</div>
        <div className="swarm-counts">
          <span><b>{activeCount}</b> active</span>
          <span><b>{doneCount}</b> done</span>
          <span><b>{idleCount}</b> idle</span>
        </div>
      </div>

      <div className="progress">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span className="progress-num">{activeCount + doneCount}/{total}</span>
      </div>

      <div className="swarm-table">
        <div className="swarm-row swarm-header-row">
          <span />
          <span>Agent</span>
          <span className="num">Output</span>
          <span className="num">Last</span>
        </div>
        {statuses.map((agent) => {
          const definition = agentById(agent.agentId);
          const region = regionById(definition.regionBinding);
          return (
            <div key={agent.agentId} className={`swarm-row ${agent.state}`}>
              <AgentMark state={agent.state} />
              <div className="ag-info">
                <div className="ag-name">{agent.label}</div>
                <div className="ag-domain" style={{ color: region.emissive }}>{agent.kind === 'boss' ? 'Orchestrator' : 'Specialist'}</div>
              </div>
              <div className="ag-output">{fallbackDetail(agent)}</div>
              <div className="ag-note">{agent.state}</div>
            </div>
          );
        })}
      </div>

      <div className="swarm-foot">
        <span>Last orchestration</span>
        <span className="dots-fill" />
        <span>—</span>
      </div>
    </div>
  );
});
