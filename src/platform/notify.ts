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
