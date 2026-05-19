import { useAgentStore } from '@core/store/agentStore';

export function ActivityLog() {
  const activity = useAgentStore((s) => s.activity);
  return (
    <aside className="activity-log" aria-label="Agent activity">
      <header>
        <h4>Activity</h4>
      </header>
      <ul>
        {activity.length === 0 && <li className="empty">idle</li>}
        {activity.slice(0, 30).map((r) => (
          <li key={r.id}>
            <time>{new Date(r.ts).toLocaleTimeString()}</time>
            <span className="agent">{r.agentId}</span>
            <span className="phase">{r.phase}</span>
            {r.detail && <span className="detail">{r.detail}</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
