import { create } from 'zustand';
import { DEFAULT_MODE, type ModeId } from '@config/modes';
import { bus } from '@core/bus/EventBus';

interface ModeStore {
  mode: ModeId;
  setMode: (m: ModeId) => void;
}

export const useModeStore = create<ModeStore>((set, get) => ({
  mode: DEFAULT_MODE,
  setMode: (m) => {
    const from = get().mode;
    if (from === m) return;
    set({ mode: m });
    bus.emit('mode:change', { from, to: m });
  },
}));
