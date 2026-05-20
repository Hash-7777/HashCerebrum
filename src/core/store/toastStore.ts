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

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastStore>((set) => ({
  message: null,
  tone: 'info',
  show: (message, tone = 'info') => {
    if (timer) clearTimeout(timer);
    set({ message, tone });
    timer = setTimeout(() => {
      timer = null;
      set({ message: null });
    }, TOAST_MS);
  },
}));

// Convenience for non-component callers.
export function showToast(message: string, tone: ToastTone = 'info') {
  useToastStore.getState().show(message, tone);
}
