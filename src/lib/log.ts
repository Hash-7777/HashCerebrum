// Tiny structured logger. Renderer-side; Rust logs separately via tracing.
// Levels gated via VITE_LOG_LEVEL env at build time.

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];
const MIN: Level = (import.meta.env['VITE_LOG_LEVEL'] as Level) ?? 'info';

const shouldLog = (lvl: Level) => LEVELS.indexOf(lvl) >= LEVELS.indexOf(MIN);

const fmt = (lvl: Level, scope: string, msg: string, extra?: unknown) => {
  const ts = new Date().toISOString();
  const tag = `[${ts}] ${lvl.toUpperCase().padEnd(5)} ${scope} —`;
  return extra === undefined ? [tag, msg] : [tag, msg, extra];
};

export const log = (scope: string) => ({
  debug: (msg: string, extra?: unknown) =>
    shouldLog('debug') && console.debug(...fmt('debug', scope, msg, extra)),
  info: (msg: string, extra?: unknown) =>
    shouldLog('info') && console.info(...fmt('info', scope, msg, extra)),
  warn: (msg: string, extra?: unknown) =>
    shouldLog('warn') && console.warn(...fmt('warn', scope, msg, extra)),
  error: (msg: string, extra?: unknown) =>
    shouldLog('error') && console.error(...fmt('error', scope, msg, extra)),
});
