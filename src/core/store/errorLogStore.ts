// In-app runtime error log for developer diagnostics.
//
// Captures uncaught errors, unhandled promise rejections, and console.error
// calls into an in-memory ring buffer the Dev tab can surface — so failures
// that would otherwise only land in the devtools console are visible inside the
// running app ("errors in the background"). Capture is installed once at boot;
// the store itself is safe to import anywhere.

import { create } from 'zustand';

export type ErrorSource = 'window' | 'promise' | 'console' | 'boundary';

export interface CapturedError {
  id: string;
  ts: number;
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
  push: (entry: { source: ErrorSource; message: string; stack?: string }) => void;
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
      // Collapse an immediate duplicate (same message + source) into a count-less
      // single most-recent entry to avoid floods from a repeated log.
      const last = s.errors[0];
      if (last && last.source === entry.source && last.message === message) {
        return { errors: [{ ...last, ts: Date.now() }, ...s.errors.slice(1)] };
      }
      const next: CapturedError = {
        id: `e${++seq}`,
        ts: Date.now(),
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

/** Install global error capture. Call once at app startup (main.tsx). */
export function installErrorCapture(): void {
  if (installed) return;
  installed = true;
  const push = useErrorLogStore.getState().push;

  window.addEventListener('error', (event) => {
    const err = event.error as Error | undefined;
    push({
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
    push({ source: 'promise', message, ...(stack ? { stack } : {}) });
  });

  // Mirror console.error into the log without suppressing the real output.
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    try {
      const message = args
        .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeStringify(a)))
        .join(' ');
      const stackArg = args.find((a): a is Error => a instanceof Error);
      push({ source: 'console', message, ...(stackArg?.stack ? { stack: stackArg.stack } : {}) });
    } catch {
      /* never let logging crash the logger */
    }
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
