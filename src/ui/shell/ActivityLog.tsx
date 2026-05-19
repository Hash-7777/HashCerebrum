import { useAgentStore } from '@core/store/agentStore';
import { Icon, type IconName } from '@ui/icons';

const PHASE_ICON: Record<string, IconName> = {
  start: 'pulse',
  tool_call: 'search',
  tool_result: 'check',
  token: 'pulse',
  done: 'check',
  error: 'alert',
};

export function ActivityLog() {
  const activity = useAgentStore((s) => s.activity);
  return (
    <aside className="activity-log" aria-label="Agent activity">
      <header className="activity-log-header">
        <h4>Activity</h4>
        <span>{activity.length}</span>
      </header>
      <ul>
        {activity.length === 0 && (
          <li className="activity-log-empty">
            <Icon name="pulse" size={14} />
            <span>idle</span>
          </li>
        )}
        {activity.slice(0, 50).map((r) => (
          <li key={r.id} data-phase={r.phase}>
            <Icon name={PHASE_ICON[r.phase] ?? 'pulse'} size={12} />
            <time>{new Date(r.ts).toLocaleTimeString()}</time>
            <span className="activity-agent">{r.agentId}</span>
            <span className="activity-phase">{r.phase}</span>
            {r.detail && <span className="activity-detail">{r.detail}</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
