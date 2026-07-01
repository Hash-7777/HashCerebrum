import { useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore, type ActivityRecord } from '@core/store/agentStore';
import { useTraceLogStore } from '@core/store/traceLogStore';
import { downloadBlob } from '@features/brain/export/messageExport';
import { Icon, type IconName } from '@ui/icons';

type TraceScope = 'run' | 'all';

// How close to the bottom (px) still counts as "following" the latest output.
const STICK_THRESHOLD = 28;

const TRACE_LIMIT = 120;

// Persist the scope choice so a user who wants the full persistent log (with
// every captured error) keeps it across restarts instead of resetting to 'run'.
const SCOPE_KEY = 'hc.trace.scope.v1';
function loadScope(): TraceScope {
  try {
    return window.localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'run';
  } catch {
    return 'run';
  }
}
function saveScope(scope: TraceScope): void {
  try {
    window.localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    /* storage may be unavailable */
  }
}

const PHASE_ICON: Record<string, IconName> = {
  start: 'pulse',
  tool_call: 'search',
  tool_result: 'check',
  token: 'pulse',
  done: 'check',
  warn: 'alert',
  error: 'alert',
};

const PHASE_CLASS: Record<string, string> = {
  start: 'run',
  tool_call: 'wait',
  tool_result: 'ok',
  token: 'run',
  done: 'ok',
  warn: 'warn',
  error: 'err',
};

function elapsed(record: ActivityRecord, start: number): string {
  return `${((record.ts - start) / 1000).toFixed(1)}s`;
}

// A persisted "app session started" boundary. The trace log survives restarts, so
// without this the relative clock counts from the very first entry ever recorded
// and shows meaningless six-digit second counts (e.g. 606807.9s) after a few
// sessions.
function isSessionBoundary(r: ActivityRecord): boolean {
  return r.agentId === 'system' && r.phase === 'start' && /session started/i.test(r.detail ?? '');
}

// For an oldest-first list, the session-start ts each entry is measured against,
// so every "app session started" restarts the relative clock near zero.
function sessionStarts(ordered: ActivityRecord[]): number[] {
  let current = ordered[0]?.ts ?? Date.now();
  return ordered.map((r) => {
    if (isSessionBoundary(r)) current = r.ts;
    return current;
  });
}

function summaryFor(activity: ActivityRecord[]): string {
  const latest = activity[0];
  if (!latest) return 'No run yet';
  return latest.detail || `${latest.agentId} ${latest.phase}`;
}

// Markdown export of the live trace, matching the `- **agent** · phase — detail`
// format used by the chat Markdown export, with a relative timestamp prefix.
function buildTraceMarkdown(activity: ActivityRecord[]): string {
  const ordered = [...activity].reverse(); // oldest first
  const starts = sessionStarts(ordered); // session-relative, so times reset per session
  const lines: string[] = [
    '# Execution Trace',
    '',
    `_Exported ${new Date().toLocaleString()}_`,
    '',
  ];
  ordered.forEach((r, i) => {
    const t = `${((r.ts - (starts[i] ?? r.ts)) / 1000).toFixed(1)}s`;
    lines.push(`- \`[${t}]\` **${r.agentId}** · ${r.phase}${r.detail ? ` — ${r.detail}` : ''}`);
  });
  lines.push('');
  return lines.join('\n');
}

function traceState(activity: ActivityRecord[]): 'idle' | 'running' | 'done' | 'error' {
  const latest = activity[0];
  if (!latest) return 'idle';
  if (latest.phase === 'error') return 'error';
  if (latest.phase === 'done') return 'done';
  return 'running';
}

export function ExecutionTrace() {
  const liveActivity = useAgentStore((s) => s.activity);
  const clearRun = useAgentStore((s) => s.clear);
  const persistent = useTraceLogStore((s) => s.entries);
  const clearAll = useTraceLogStore((s) => s.clear);
  // "run" shows the current run (cleared each run); "all" shows the persistent,
  // cross-chat, survives-restart log for debugging background steps and failures.
  const [scope, setScope] = useState<TraceScope>(loadScope);
  const activity = scope === 'all' ? persistent : liveActivity;
  const clear = scope === 'all' ? clearAll : clearRun;
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
  const visibleStarts = useMemo(() => sessionStarts(visible), [visible]);

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
        <button
          type="button"
          className="execution-trace-scope"
          onClick={(event) => {
            event.stopPropagation();
            setScope((value) => {
              const next = value === 'run' ? 'all' : 'run';
              saveScope(next);
              return next;
            });
          }}
          title={scope === 'all' ? 'Showing the full persistent log — click for this run only' : 'Showing this run — click for the full persistent log'}
        >
          {scope === 'all' ? 'All' : 'Run'}
        </button>
        <span className="execution-trace-summary">{summaryFor(activity)}</span>
        {activity.length > 0 && (
          <button
            type="button"
            className="execution-trace-export"
            onClick={(event) => {
              event.stopPropagation();
              downloadBlob(
                scope === 'all' ? 'execution-trace-all.md' : 'execution-trace.md',
                new Blob([buildTraceMarkdown(activity)], { type: 'text/markdown;charset=utf-8' }),
              );
            }}
            title="Export the trace as Markdown"
          >
            Export MD
          </button>
        )}
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
        {visible.map((record, i) => {
          const phase = PHASE_CLASS[record.phase] ?? 'wait';
          return (
            <div key={record.id} className={`execution-trace-entry trace-${phase}`}>
              <span className="trace-time">[{elapsed(record, visibleStarts[i] ?? record.ts)}]</span>
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
