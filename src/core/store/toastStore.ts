// Tiny transient-notification store. A toast auto-clears after 3 seconds;
// a fresh toast resets the timer.

import { create } from 'zustand';

export type ToastTone = 'info' | 'error';

const TOAST_MS = 3000;

interface ToastStore {
  message: string | null;
  tone: ToastTone;
  show: (message: string, tone?: ToastTone) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>((set, get) => ({
  message: null,
  tone: 'info',
  show: (message, tone = 'info') => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    set({ message, tone });
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      timers.delete(id);
      if (get().message === message && get().tone === tone) {
        set({ message: null });
      }
    }, TOAST_MS);
    timers.set(id, timer);
  },
}));

// Convenience for non-component callers.
export function showToast(message: string, tone: ToastTone = 'info') {
  useToastStore.getState().show(message, tone);
}
