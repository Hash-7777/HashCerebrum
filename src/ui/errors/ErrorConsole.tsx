// Developer error surface. ErrorConsole is the full panel shown in the Settings
// "Dev" tab; ErrorOverlay is an opt-in floating badge that surfaces the same
// captured errors anywhere in the app for live debugging. Both read the shared
// errorLogStore, which is fed by the global capture installed at boot.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useErrorLogStore, type CapturedError } from '@core/store/errorLogStore';
import { Icon } from '@ui/icons';

function ErrorItem({ error }: { error: CapturedError }) {
  return (
    <li data-source={error.source}>
      <div className="dev-error-head">
        <span className="dev-error-source">{error.source}</span>
        <time>{new Date(error.ts).toLocaleTimeString()}</time>
      </div>
      <p className="dev-error-msg">{error.message}</p>
      {error.stack && <pre className="dev-error-stack">{error.stack}</pre>}
    </li>
  );
}

export function ErrorConsole() {
  const errors = useErrorLogStore((s) => s.errors);
  const clear = useErrorLogStore((s) => s.clear);
  const overlay = useErrorLogStore((s) => s.overlay);
  const setOverlay = useErrorLogStore((s) => s.setOverlay);

  return (
    <section className="dev-errors" aria-label="Runtime errors">
      <header>
        <strong>Runtime errors</strong>
        <span className="dev-errors-count" data-empty={errors.length === 0}>
          {errors.length}
        </span>
      </header>
      <p className="field-hint">
        Uncaught errors, unhandled promise rejections, and console errors captured this session —
        so failures are visible in the app, not just the devtools console.
      </p>
      <label className="toggle-row">
        <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
        <span>Show a floating error overlay across the app</span>
      </label>
      <div className="dev-errors-actions">
        <button type="button" onClick={clear} disabled={errors.length === 0}>
          Clear
        </button>
      </div>
      {errors.length === 0 ? (
        <p className="dev-errors-empty">No errors captured this session.</p>
      ) : (
        <ol className="dev-errors-list">
          {errors.map((e) => (
            <ErrorItem key={e.id} error={e} />
          ))}
        </ol>
      )}
    </section>
  );
}

export function ErrorOverlay() {
  const overlay = useErrorLogStore((s) => s.overlay);
  const errors = useErrorLogStore((s) => s.errors);
  const clear = useErrorLogStore((s) => s.clear);
  const [open, setOpen] = useState(false);

  if (!overlay) return null;

  return createPortal(
    <div className="dev-overlay">
      {open && (
        <div className="dev-overlay-panel" role="dialog" aria-label="Runtime errors">
          <header>
            <strong>Runtime errors · {errors.length}</strong>
            <div>
              <button type="button" onClick={clear} disabled={errors.length === 0}>
                Clear
              </button>
              <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="close" size={13} />
              </button>
            </div>
          </header>
          {errors.length === 0 ? (
            <p className="dev-errors-empty">No errors captured.</p>
          ) : (
            <ol className="dev-errors-list">
              {errors.slice(0, 50).map((e) => (
                <ErrorItem key={e.id} error={e} />
              ))}
            </ol>
          )}
        </div>
      )}
      <button
        type="button"
        className="dev-overlay-badge"
        data-has={errors.length > 0}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Runtime errors: ${errors.length}`}
        title={`Runtime errors: ${errors.length}`}
      >
        <Icon name="activity" size={13} /> {errors.length}
      </button>
    </div>,
    document.body,
  );
}
