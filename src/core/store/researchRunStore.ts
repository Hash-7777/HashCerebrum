import { create } from 'zustand';
import type { AgentId } from '@config/agents';
import type { EvidenceItem } from '@platform/index';
import { platform } from '@platform/index';
import { useProjectStore } from './projectStore';

const STORAGE_KEY = 'research.runs.v1';
const MAX_RUNS = 50;

export type ResearchRunStatus = 'running' | 'stored' | 'summarized' | 'error';
export type ResearchAgentStatus = 'idle' | 'running' | 'done' | 'error';

export interface ResearchAgentStep {
  agentId: AgentId;
  status: ResearchAgentStatus;
  sourceIds: EvidenceItem['source'][];
  startedAt?: string;
  completedAt?: string;
  detail?: string;
  recordCount: number;
}

export interface ResearchRun {
  id: string;
  projectId: string;
  query: string;
  status: ResearchRunStatus;
  startedAt: string;
  completedAt?: string;
  evidenceStoredAt?: string;
  summaryStoredAt?: string;
  evidence: EvidenceItem[];
  agentSteps: ResearchAgentStep[];
  summary?: string;
  modelUsed?: string;
  error?: string;
}

interface PersistShape {
  runs: ResearchRun[];
  activeRunId: string | null;
}

interface ResearchRunStore extends PersistShape {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  startRun: (query: string, steps: ResearchAgentStep[]) => ResearchRun;
  updateStep: (runId: string, agentId: AgentId, update: Partial<ResearchAgentStep>) => void;
  storeEvidence: (runId: string, evidence: EvidenceItem[]) => void;
  storeSummary: (runId: string, summary: string, modelUsed?: string) => void;
  failRun: (runId: string, error: string) => void;
  getRun: (runId: string) => ResearchRun | undefined;
}

const emptyShape = (): PersistShape => ({ runs: [], activeRunId: null });

function normalizeShape(shape: Partial<PersistShape> | null | undefined): PersistShape {
  return {
    runs: Array.isArray(shape?.runs) ? shape.runs.slice(0, MAX_RUNS) : [],
    activeRunId: typeof shape?.activeRunId === 'string' ? shape.activeRunId : null,
  };
}

async function loadPersisted(): Promise<PersistShape> {
  try {
    return normalizeShape(await platform().storage.get<PersistShape>(STORAGE_KEY));
  } catch {
    return emptyShape();
  }
}

function persist(shape: PersistShape) {
  void platform().storage.set(STORAGE_KEY, shape).catch(() => undefined);
}

function updateRun(runs: ResearchRun[], runId: string, update: (run: ResearchRun) => ResearchRun): ResearchRun[] {
  return runs.map((run) => (run.id === runId ? update(run) : run));
}

export const useResearchRunStore = create<ResearchRunStore>((set, get) => ({
  ...emptyShape(),
  hydrated: false,

  hydrate: async () => {
    const persisted = await loadPersisted();
    set((state) => ({ ...state, ...persisted, hydrated: true }));
  },

  startRun: (query, steps) => {
    const run: ResearchRun = {
      id: crypto.randomUUID(),
      projectId: useProjectStore.getState().activeProjectId ?? '',
      query,
      status: 'running',
      startedAt: new Date().toISOString(),
      evidence: [],
      agentSteps: steps,
    };
    set((state) => {
      const next = { runs: [run, ...state.runs].slice(0, MAX_RUNS), activeRunId: run.id };
      persist(next);
      return { ...state, ...next };
    });
    return run;
  },

  updateStep: (runId, agentId, update) =>
    set((state) => {
      const next = {
        runs: updateRun(state.runs, runId, (run) => ({
          ...run,
          agentSteps: run.agentSteps.map((step) => (step.agentId === agentId ? { ...step, ...update } : step)),
        })),
        activeRunId: state.activeRunId,
      };
      persist(next);
      return { ...state, ...next };
    }),

  storeEvidence: (runId, evidence) =>
    set((state) => {
      const now = new Date().toISOString();
      const next = {
        runs: updateRun(state.runs, runId, (run) => ({
          ...run,
          status: 'stored',
          evidence,
          evidenceStoredAt: now,
        })),
        activeRunId: state.activeRunId,
      };
      persist(next);
      return { ...state, ...next };
    }),

  storeSummary: (runId, summary, modelUsed) =>
    set((state) => {
      const now = new Date().toISOString();
      const next = {
        runs: updateRun(state.runs, runId, (run) => ({
          ...run,
          status: 'summarized',
          completedAt: now,
          summaryStoredAt: now,
          summary,
          ...(modelUsed ? { modelUsed } : {}),
        })),
        activeRunId: state.activeRunId,
      };
      persist(next);
      return { ...state, ...next };
    }),

  failRun: (runId, error) =>
    set((state) => {
      const now = new Date().toISOString();
      const next = {
        runs: updateRun(state.runs, runId, (run) => ({
          ...run,
          status: 'error',
          completedAt: now,
          error,
        })),
        activeRunId: state.activeRunId,
      };
      persist(next);
      return { ...state, ...next };
    }),

  getRun: (runId) => get().runs.find((run) => run.id === runId),
}));
