import { create } from 'zustand';
import type { AgentId } from '@config/agents';
import { bus } from '@core/bus/EventBus';

export interface ActivityRecord {
  id: string;
  agentId: AgentId;
  phase: string;
  detail?: string;
  ts: number;
}

interface AgentStore {
  activity: ActivityRecord[];
  push: (r: Omit<ActivityRecord, 'id' | 'ts'>) => void;
  clear: () => void;
}

const MAX_ACTIVITY = 500;

export const useAgentStore = create<AgentStore>((set) => ({
  activity: [],
  push: (r) =>
    set((s) => ({
      activity: [
        { ...r, id: crypto.randomUUID(), ts: Date.now() },
        ...s.activity,
      ].slice(0, MAX_ACTIVITY),
    })),
  clear: () => set({ activity: [] }),
}));

bus.on('agent:activity', (e) => {
  useAgentStore.getState().push({ agentId: e.agentId, phase: e.phase, ...(e.detail !== undefined ? { detail: e.detail } : {}) });
});
