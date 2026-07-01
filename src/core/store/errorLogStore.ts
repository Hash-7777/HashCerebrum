// In-app runtime error log for developer diagnostics.
//
// Captures uncaught errors, unhandled promise rejections, and console.error /
// console.warn calls into an in-memory ring buffer the Dev tab can surface — so
// failures that would otherwise only land in the devtools console (or be
// swallowed entirely) are visible inside the running app. Every captured item
// is ALSO mirrored into the persistent, app-wide execution trace, so even
// silent code-level errors show up in the Trace panel, survive mode switches
// and app restarts, and are cleared only when the user presses Clear. Capture
// is installed once at boot; the store itself is safe to import anywhere.

import { create } from 'zustand';
import { useTraceLogStore } from './traceLogStore';

export type ErrorSource = 'window' | 'promise' | 'console' | 'boundary';
export type ErrorLevel = 'error' | 'warn';

export interface CapturedError {
  id: string;
  ts: number;
  level: ErrorLevel;
  source: ErrorSource;
  message: string;
  stack?: string;
}

const MAX_ERRORS = 200;
const OVERLAY_KEY = 'hc.dev.errorOverlay.v1';

function loadOverlay(): boolean {
  try {
    return window.localStorage.getItem(OVERLAY_KEY) === 'true';
  } catch {
    return false;
  }
}

interface ErrorLogStore {
  errors: CapturedError[];
  overlay: boolean;
  push: (entry: { source: ErrorSource; message: string; stack?: string; level?: ErrorLevel }) => void;
  clear: () => void;
  setOverlay: (value: boolean) => void;
}

let seq = 0;

export const useErrorLogStore = create<ErrorLogStore>((set) => ({
  errors: [],
  overlay: loadOverlay(),
  push: (entry) =>
    set((s) => {
      const message = (entry.message || '').trim() || 'Unknown error';
      const level: ErrorLevel = entry.level ?? 'error';
      // Collapse an immediate duplicate (same message + source) into a count-less
      // single most-recent entry to avoid floods from a repeated log.
      const last = s.errors[0];
      if (last && last.source === entry.source && last.message === message) {
        return { errors: [{ ...last, ts: Date.now() }, ...s.errors.slice(1)] };
      }
      const next: CapturedError = {
        id: `e${++seq}`,
        ts: Date.now(),
        level,
        source: entry.source,
        message,
        ...(entry.stack ? { stack: entry.stack } : {}),
      };
      return { errors: [next, ...s.errors].slice(0, MAX_ERRORS) };
    }),
  clear: () => set({ errors: [] }),
  setOverlay: (value) => {
    try {
      window.localStorage.setItem(OVERLAY_KEY, value ? 'true' : 'false');
    } catch {
      /* storage may be unavailable; the in-memory flag still works */
    }
    set({ overlay: value });
  },
}));

let installed = false;
// The last message mirrored into the trace, so a repeated log does not flood the
// persistent trace with identical consecutive lines.
let lastTraceMessage = '';

// Benign upstream-library console noise that is not an app problem. These still
// print to devtools (we call the original console method first) but are kept out
// of the user-facing error log and execution trace, where they read as spurious
// "warnings" the user cannot act on. Currently: three.js deprecation notices
// emitted from inside @react-three/fiber's render loop (e.g. THREE.Clock /
// PCFSoftShadowMap), which we do not call directly and cannot silence at source.
const THIRD_PARTY_NOISE = /THREE\.\w+.*deprecated/i;

/** Mirror a captured item into the persistent execution trace, so even silent
 *  errors appear in the Trace panel (and survive restarts). Never throws. */
function mirrorToTrace(level: ErrorLevel, message: string): void {
  if (!message || message === lastTraceMessage) return;
  lastTraceMessage = message;
  try {
    useTraceLogStore.getState().add({
      agentId: 'system',
      phase: level === 'warn' ? 'warn' : 'error',
      detail: message,
    });
  } catch {
    /* never let logging crash the logger */
  }
}

/** Record into both the error log and the persistent trace. */
function record(entry: { source: ErrorSource; message: string; stack?: string; level?: ErrorLevel }): void {
  const level = entry.level ?? 'error';
  const message = (entry.message || '').trim() || (level === 'warn' ? 'Warning' : 'Unknown error');
  useErrorLogStore.getState().push({ ...entry, level, message });
  mirrorToTrace(level, message);
}

/** Install global error capture. Call once at app startup (main.tsx). */
export function installErrorCapture(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    const err = event.error as Error | undefined;
    record({
      source: 'window',
      message: err?.message ?? event.message ?? 'Uncaught error',
      ...(err?.stack ? { stack: err.stack } : {}),
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    const message =
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'Unhandled promise rejection';
    const stack = reason instanceof Error ? reason.stack : undefined;
    record({ source: 'promise', message, ...(stack ? { stack } : {}) });
  });

  // Mirror console.error / console.warn into the log + trace without suppressing
  // the real devtools output. These are where most "silent" failures already
  // land (swallowed catches that still log), so capturing both surfaces them.
  const wrap = (level: ErrorLevel, original: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      original(...args);
      try {
        const message = args
          .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeStringify(a)))
          .join(' ');
        // Devtools still saw it above; keep benign upstream noise out of the log/trace.
        if (THIRD_PARTY_NOISE.test(message)) return;
        const stackArg = args.find((a): a is Error => a instanceof Error);
        record({ source: 'console', level, message, ...(stackArg?.stack ? { stack: stackArg.stack } : {}) });
      } catch {
        /* never let logging crash the logger */
      }
    };

  console.error = wrap('error', console.error.bind(console));
  console.warn = wrap('warn', console.warn.bind(console));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
