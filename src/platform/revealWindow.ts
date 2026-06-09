// Reveal the Tauri window exactly once, after the dark UI has painted. The
// window is created hidden (tauri.conf.json) so the WebView's white default can
// never flash on launch; this shows it only once real content is on screen.
// Idempotent and a no-op outside the desktop runtime (browser dev).

let revealed = false;

export function revealWindow(): void {
  if (revealed) return;
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  void import('@tauri-apps/api/window')
    .then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus().catch(() => {});
      // Only mark revealed once show() actually succeeded — if an early-boot call
      // raced and threw, `revealed` stays false so a later call (boot splash or
      // the timed fallback) can retry. Marking it true up front was why a single
      // failed attempt left the window hidden until the app was reopened.
      revealed = true;
    })
    .catch(() => {
      /* show failed this time — leave `revealed` false so a later call retries */
    });
}
