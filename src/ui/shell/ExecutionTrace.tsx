import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore, type ActivityRecord } from '@core/store/agentStore';
import { Icon, type IconName } from '@ui/icons';

// How close to the bottom (px) still counts as "following" the latest output.
const STICK_THRESHOLD = 28;

const TRACE_LIMIT = 120;

const PHASE_ICON: Record<string, IconName> = {
  start: 'pulse',
  tool_call: 'search',
  tool_result: 'check',
  token: 'pulse',
  done: 'check',
  error: 'alert',
};

const PHASE_CLASS: Record<string, string> = {
  start: 'run',
  tool_call: 'wait',
  tool_result: 'ok',
  token: 'run',
  done: 'ok',
  error: 'err',
};

function elapsed(record: ActivityRecord, start: number): string {
  return `${((record.ts - start) / 1000).toFixed(1)}s`;
}

function summaryFor(activity: ActivityRecord[]): string {
  const latest = activity[0];
  if (!latest) return 'No run yet';
  return latest.detail || `${latest.agentId} ${latest.phase}`;
}

function traceState(activity: ActivityRecord[]): 'idle' | 'running' | 'done' | 'error' {
  const latest = activity[0];
  if (!latest) return 'idle';
  if (latest.phase === 'error') return 'error';
  if (latest.phase === 'done') return 'done';
  return 'running';
}

export function ExecutionTrace() {
  const activity = useAgentStore((s) => s.activity);
  const clear = useAgentStore((s) => s.clear);
  const [expanded, setExpanded] = useState(false);
  const entriesRef = useRef<HTMLDivElement>(null);
  // Follow new output by default; released when the user scrolls up, re-armed
  // when they scroll back to the bottom.
  const followRef = useRef(true);

  const onScroll = () => {
    const el = entriesRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
  };

  useEffect(() => {
    const onToggle = () => setExpanded((v) => !v);
    window.addEventListener('hc:toggle-trace', onToggle);
    // Legacy event — keep so any existing callers still work (opens only)
    const onExpand = () => setExpanded(true);
    window.addEventListener('hc:expand-trace', onExpand);
    return () => {
      window.removeEventListener('hc:toggle-trace', onToggle);
      window.removeEventListener('hc:expand-trace', onExpand);
    };
  }, []);
  const state = traceState(activity);
  const visible = useMemo(() => activity.slice(0, TRACE_LIMIT).reverse(), [activity]);
  const startTime = visible[0]?.ts ?? Date.now();

  // Opening the panel re-arms following so it jumps to the latest line.
  useEffect(() => {
    if (expanded) followRef.current = true;
  }, [expanded]);

  // Stick to the bottom as new entries arrive — unless the user scrolled up.
  useEffect(() => {
    const el = entriesRef.current;
    if (!el || !expanded || !followRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [visible, expanded]);

  return (
    <aside className={`execution-trace ${expanded ? 'expanded' : 'collapsed'}`} aria-label="Execution trace">
      <div
        className="execution-trace-header"
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
      >
        <span className="execution-trace-dot" data-state={state} />
        <span className="execution-trace-label">Trace</span>
        <span className="execution-trace-summary">{summaryFor(activity)}</span>
        <button
          type="button"
          className="execution-trace-clear"
          onClick={(event) => {
            event.stopPropagation();
            clear();
          }}
        >
          Clear
        </button>
        <Icon name="eye" size={13} />
      </div>

      <div className="execution-trace-entries" ref={entriesRef} onScroll={onScroll}>
        {visible.length === 0 && (
          <div className="execution-trace-entry trace-wait">
            <span className="trace-time">[0.0s]</span>
            <span className="trace-agent">System</span>
            <Icon name="pulse" size={12} />
            <span className="trace-msg">idle</span>
          </div>
        )}
        {visible.map((record) => {
          const phase = PHASE_CLASS[record.phase] ?? 'wait';
          return (
            <div key={record.id} className={`execution-trace-entry trace-${phase}`}>
              <span className="trace-time">[{elapsed(record, startTime)}]</span>
              <span className="trace-agent">{record.agentId}</span>
              <Icon name={PHASE_ICON[record.phase] ?? 'pulse'} size={12} />
              <span className="trace-msg">{record.detail || record.phase}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
