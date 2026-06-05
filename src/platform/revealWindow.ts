// Reveal the Tauri window exactly once, after the dark UI has painted. The
// window is created hidden (tauri.conf.json) so the WebView's white default can
// never flash on launch; this shows it only once real content is on screen.
// Idempotent and a no-op outside the desktop runtime (browser dev).

let revealed = false;

export function revealWindow(): void {
  if (revealed) return;
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  revealed = true;
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => getCurrentWindow().show())
    .catch(() => {
      /* show unavailable — the window stays as created */
    });
}
