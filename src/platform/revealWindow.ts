// Reveal the Tauri window after the dark UI has painted — restoring its last
// size + position first, so it reopens exactly where the user left it.
//
// The window is created hidden (tauri.conf.json) so the WebView's white default
// can never flash on launch. We restore the saved geometry and THEN show in one
// sequence: setting size/position while the window is still hidden and revealing
// it in the same beat is what makes the placement stick on macOS.
//
// Geometry is persisted by POLLING the live outer-position / inner-size on a
// timer (plus a flush when the page unloads) — the approach proven in HashCortX.
// An earlier event-based version (onMoved/onResized) did not reliably persist in
// the packaged app, so nothing was ever saved and the window re-centred every
// launch. Polling reads the real geometry directly and cannot miss it.
//
// Idempotent, and a no-op outside the desktop runtime (browser dev).

import type { Window } from '@tauri-apps/api/window';

const SIZE_KEY = 'hc_win_size';
const POS_KEY = 'hc_win_pos';
const SAVE_INTERVAL_MS = 2000;

let started = false;

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
      /* ignore — fall through to the config default */
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

// Persist geometry by reading the live outer position + inner size every couple
// of seconds (only writing when it actually changed), plus an immediate flush on
// page unload so a move made in the last tick is not lost.
function startPersistence(win: Window): void {
  let lastX: number | undefined;
  let lastY: number | undefined;
  let lastW: number | undefined;
  let lastH: number | undefined;

  const save = async (): Promise<void> => {
    try {
      const pos = await win.outerPosition();
      if (pos.x !== lastX || pos.y !== lastY) {
        lastX = pos.x;
        lastY = pos.y;
        localStorage.setItem(POS_KEY, JSON.stringify({ x: pos.x, y: pos.y }));
      }
    } catch {
      /* ignore a single failed read */
    }
    try {
      const size = await win.innerSize();
      if (size.width !== lastW || size.height !== lastH) {
        lastW = size.width;
        lastH = size.height;
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: size.width, height: size.height }));
      }
    } catch {
      /* ignore a single failed read */
    }
  };

  setInterval(() => void save(), SAVE_INTERVAL_MS);
  window.addEventListener('pagehide', () => void save());
  window.addEventListener('beforeunload', () => void save());
}

export function revealWindow(): void {
  if (started) return;
  if (!isDesktop()) return;
  // Claim the single reveal up front so the timed retries + boot-splash call do
  // not run the restore concurrently; released again only if this attempt fails.
  started = true;
  void import('@tauri-apps/api/window')
    .then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      await restoreGeometry(win);
      await win.show();
      await win.setFocus().catch(() => {});
      startPersistence(win);
    })
    .catch(() => {
      // Reveal failed this time — let a later call (timed fallback / boot splash)
      // retry rather than leaving the window hidden forever.
      started = false;
    });
}
