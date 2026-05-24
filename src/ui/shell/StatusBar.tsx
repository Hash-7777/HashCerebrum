import { useAgentStore } from '@core/store/agentStore';
import { useModeStore } from '@core/store/modeStore';

export function StatusBar() {
  const mode = useModeStore((s) => s.mode);
  const activity = useAgentStore((s) => s.activity);
  const latest = activity[0];

  return (
    <div className="statusbar">
      <span className="live">
        <span className="live-dot" aria-hidden="true" />
        TRACE
      </span>
      <span className="sep">/</span>
      <span>{mode}</span>
      {latest && (
        <>
          <span className="sep">·</span>
          <span>{latest.agentId}</span>
          <span className="sep">·</span>
          <span>{latest.detail ?? latest.phase}</span>
        </>
      )}
      <div className="right">
        <span>events {activity.length}</span>
      </div>
    </div>
  );
}
