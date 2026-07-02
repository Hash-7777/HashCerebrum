// Reveal the Tauri window after the dark UI has painted — restoring its last
// size + position first, so it reopens exactly where the user left it.
//
// The window is created hidden (tauri.conf.json) so the WebView's white default
// can never flash on launch. We restore the saved geometry and THEN show in one
// sequence: setting size/position while the window is still hidden and revealing
// it in the same beat is what makes the placement stick on macOS — the window
// manager never gets a chance to re-place the frame. Geometry is persisted to
// localStorage on every move/resize, so it survives quit + relaunch. This mirrors
// the approach proven in HashCortX. Idempotent, and a no-op outside the desktop
// runtime (browser dev).

import type { Window } from '@tauri-apps/api/window';

const SIZE_KEY = 'hc_win_size';
const POS_KEY = 'hc_win_pos';

let revealed = false;
let persisting = false;

const isDesktop = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const finite = (n: unknown): boolean => Number.isFinite(Number(n));

function readPair(key: string): Record<string, number> | null {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

// Restore the saved size first, then the saved position (so the OS never
// visibly re-places the frame between the two). With no saved position — a first
// launch — open centred.
async function restoreGeometry(win: Window): Promise<void> {
  const { PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/dpi');

  const size = readPair(SIZE_KEY);
  if (size && finite(size.width) && finite(size.height)) {
    try {
      await win.setSize(new PhysicalSize(Math.round(Number(size.width)), Math.round(Number(size.height))));
    } catch {
      /* ignore — fall through to whatever the config default is */
    }
  }

  const pos = readPair(POS_KEY);
  if (pos && finite(pos.x) && finite(pos.y)) {
    try {
      await win.setPosition(new PhysicalPosition(Math.round(Number(pos.x)), Math.round(Number(pos.y))));
    } catch {
      try {
        await win.center();
      } catch {
        /* ignore */
      }
    }
  } else {
    try {
      await win.center();
    } catch {
      /* ignore */
    }
  }
}

// Persist geometry as the user moves/resizes. Event-driven (no polling) and
// debounced, so a drag writes localStorage once it settles rather than on every
// intermediate frame.
function startPersistence(win: Window): void {
  if (persisting) return;
  persisting = true;

  let timer: number | undefined;
  let size: { width: number; height: number } | null = null;
  let pos: { x: number; y: number } | null = null;

  const flush = (): void => {
    timer = undefined;
    if (size) localStorage.setItem(SIZE_KEY, JSON.stringify(size));
    if (pos) localStorage.setItem(POS_KEY, JSON.stringify(pos));
  };
  const schedule = (): void => {
    if (timer === undefined) timer = window.setTimeout(flush, 400);
  };

  void win.onResized(({ payload }) => {
    size = { width: payload.width, height: payload.height };
    schedule();
  });
  void win.onMoved(({ payload }) => {
    pos = { x: payload.x, y: payload.y };
    schedule();
  });
}

export function revealWindow(): void {
  if (revealed) return;
  if (!isDesktop()) return;
  void import('@tauri-apps/api/window')
    .then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      await restoreGeometry(win);
      await win.show();
      await win.setFocus().catch(() => {});
      // Only mark revealed once show() actually succeeded — if an early-boot call
      // raced and threw, `revealed` stays false so a later call (boot splash or
      // the timed fallback) can retry.
      revealed = true;
      startPersistence(win);
    })
    .catch(() => {
      /* show failed this time — leave `revealed` false so a later call retries */
    });
}
