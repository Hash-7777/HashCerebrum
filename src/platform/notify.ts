// OS-native notification wrapper. Uses Tauri's notification plugin on desktop
// and falls back to the Web Notification API in browser dev mode.
// Requests permission on first use.

import { platform } from './index';

let granted = false;

async function ensurePermission(): Promise<boolean> {
  if (granted) return true;
  if (!platform().env.isTauri) {
    if (!('Notification' in window)) return false;
    const perm = await Notification.requestPermission();
    granted = perm === 'granted';
    return granted;
  }
  try {
    const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
    granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === 'granted';
    }
    return granted;
  } catch {
    return false;
  }
}

export async function notify(title: string, body: string): Promise<void> {
  // Light up HashNotch first. Every notify() here is a top-level completion
  // ("Manuscript complete", "Peer review complete", …), so mirroring it to the
  // notch is exactly the "finished" signal. It writes HashNotch's own local
  // feed via a Tauri command, so it needs no OS-notification permission — do it
  // even when the banner below is suppressed.
  if (platform().env.isTauri) void postNotchFinished(title);

  const ok = await ensurePermission();
  if (!ok) return;
  if (platform().env.isTauri) {
    try {
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      sendNotification({ title, body });
    } catch {
      /* silently fail — notification is best-effort */
    }
  } else {
    // eslint-disable-next-line no-new
    new Notification(title, { body });
  }
}

// Post a short "HashCerebrum" finished activity to HashNotch's local feed so
// the notch reacts like the iPhone Dynamic Island. Best-effort and
// metadata-only (the completion's title, e.g. "Manuscript complete") — never
// any research content. Silently does nothing if HashNotch isn't installed.
async function postNotchFinished(detail: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const record: Record<string, unknown> = {
      id: 'hashcerebrum',
      icon: 'checkmark.circle.fill',
      title: 'HashCerebrum',
      endsAt: new Date(Date.now() + 45000).toISOString().replace(/\.\d+Z$/, 'Z'),
    };
    const sub = (detail || '').trim();
    if (sub) record.subtitle = sub.slice(0, 120);
    await invoke('notch_activity_post', { record });
  } catch {
    /* HashNotch not installed or command unavailable — ignore */
  }
}
