import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatTraceStore, type ChatTraceEntry } from '@core/store/chatTraceStore';
import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { downloadBlob, slugifyFilename } from '@platform/download';
import { Icon, type IconName } from '@ui/icons';

// How close to the bottom (px) still counts as "following" the latest output.
const STICK_THRESHOLD = 28;

const TRACE_LIMIT = 400;
const EMPTY: ChatTraceEntry[] = [];

const PHASE_ICON: Record<string, IconName> = {
  start: 'pulse',
  routing: 'pulse',
  delegating: 'pulse',
  tool_call: 'search',
  tool_result: 'check',
  token: 'pulse',
  manuscript: 'document',
  synthesizing: 'pulse',
  done: 'check',
  warn: 'alert',
  error: 'alert',
};

// Terminal colour class per phase — greens for progress, red/amber for trouble.
const PHASE_CLASS: Record<string, string> = {
  prompt: 'prompt',
  start: 'start',
  routing: 'start',
  delegating: 'start',
  tool_call: 'call',
  tool_result: 'ok',
  token: 'run',
  manuscript: 'run',
  synthesizing: 'run',
  done: 'ok',
  warn: 'warn',
  error: 'err',
};

// A short, human tag for the phase so the log reads clearly instead of relying
// on colour alone (e.g. "search", "result", "done").
const PHASE_TAG: Record<string, string> = {
  prompt: 'you',
  start: 'start',
  routing: 'route',
  delegating: 'delegate',
  tool_call: 'search',
  tool_result: 'result',
  token: 'draft',
  manuscript: 'paper',
  synthesizing: 'synth',
  done: 'done',
  warn: 'warn',
  error: 'error',
};

// Oldest-first, the ts each entry is measured against — the first entry of the
// chat is t=0, so times read as seconds-into-this-conversation, not a giant
// wall-clock number.
function elapsedFrom(base: number, ts: number): string {
  return `${((ts - base) / 1000).toFixed(1)}s`;
}

function summaryFor(activity: ChatTraceEntry[]): string {
  const latest = activity[0];
  if (!latest) return 'No activity yet';
  if (latest.kind === 'prompt') return `you: ${latest.detail ?? ''}`;
  return latest.detail || `${latest.agentId} ${latest.phase}`;
}

// Markdown export of the trace, matching the chat Markdown export style with a
// conversation-relative timestamp and a clear marker for each sent prompt.
function buildTraceMarkdown(activity: ChatTraceEntry[]): string {
  const ordered = [...activity].reverse(); // oldest first
  const base = ordered[0]?.ts ?? Date.now();
  const lines: string[] = ['# Execution Trace', '', `_Exported ${new Date().toLocaleString()}_`, ''];
  ordered.forEach((r) => {
    if (r.kind === 'prompt') {
      lines.push('', `### ▸ You sent — ${r.detail ?? ''}`, '');
      return;
    }
    const t = elapsedFrom(base, r.ts);
    lines.push(`- \`[${t}]\` **${r.agentId}** · ${r.phase}${r.detail ? ` — ${r.detail}` : ''}`);
  });
  lines.push('');
  return lines.join('\n');
}

function traceState(activity: ChatTraceEntry[]): 'idle' | 'running' | 'done' | 'error' {
  const latest = activity[0];
  if (!latest) return 'idle';
  if (latest.phase === 'error') return 'error';
  if (latest.phase === 'done') return 'done';
  if (latest.kind === 'prompt') return 'running';
  return 'running';
}

export function ExecutionTrace() {
  const activity = useChatTraceStore((s) => s.byChat[s.activeKey] ?? EMPTY);
  const clearActive = useChatTraceStore((s) => s.clearActive);
  // The active chat's title, so the exported trace file is named after this
  // chat instead of a generic "execution-trace.md" that overwrites the last one.
  const activeChatTitle = useChatHistoryStore(
    (s) => s.chats.find((c) => c.id === s.activeChatId)?.title ?? '',
  );
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
  const baseTs = visible[0]?.ts ?? Date.now();

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
        {activity.length > 0 && (
          <button
            type="button"
            className="execution-trace-export"
            onClick={(event) => {
              event.stopPropagation();
              const named = activeChatTitle && activeChatTitle !== 'New chat';
              const filename = named ? `${slugifyFilename(activeChatTitle)}-trace.md` : 'execution-trace.md';
              downloadBlob(
                filename,
                new Blob([buildTraceMarkdown(activity)], { type: 'text/markdown;charset=utf-8' }),
              );
            }}
            title="Export this chat's trace as Markdown"
          >
            Export MD
          </button>
        )}
        <button
          type="button"
          className="execution-trace-clear"
          onClick={(event) => {
            event.stopPropagation();
            clearActive();
          }}
          title="Clear this chat's trace"
        >
          Clear
        </button>
        <Icon name="eye" size={13} />
      </div>

      <div className="execution-trace-entries" ref={entriesRef} onScroll={onScroll}>
        {visible.length === 0 && (
          <div className="execution-trace-entry trace-start">
            <span className="trace-time">[0.0s]</span>
            <span className="trace-agent">system</span>
            <span className="trace-tag">idle</span>
            <span className="trace-msg">waiting for a prompt…</span>
          </div>
        )}
        {visible.map((record) => {
          if (record.kind === 'prompt') {
            return (
              <div key={record.id} className="execution-trace-prompt">
                <span className="trace-prompt-caret">▸</span>
                <span className="trace-prompt-label">you</span>
                <span className="trace-prompt-text">{record.detail}</span>
              </div>
            );
          }
          const phase = PHASE_CLASS[record.phase] ?? 'run';
          return (
            <div key={record.id} className={`execution-trace-entry trace-${phase}`}>
              <span className="trace-time">[{elapsedFrom(baseTs, record.ts)}]</span>
              <span className="trace-agent">{record.agentId}</span>
              <Icon name={PHASE_ICON[record.phase] ?? 'pulse'} size={11} />
              <span className="trace-tag">{PHASE_TAG[record.phase] ?? record.phase}</span>
              <span className="trace-msg">{record.detail || record.phase}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
