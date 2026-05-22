// Project store — the top-level workspace grouping. A project owns its
// saved chats and (from Phase 28b) its per-project RAG knowledge store.
// The active project scopes the left rail and the brain workspace.
//
// Persisted through the platform storage adapter: Tauri Store in the
// desktop shell, localStorage in browser dev. activeProjectId IS persisted
// so the last workspace is restored on the next launch.

import { create } from 'zustand';
import { platform } from '@platform/index';

const STORAGE_KEY = 'projects.v1';
const NAME_MAX = 60;

// Neutral seed name — never bake developer or personal info into defaults.
const SEED_PROJECT_NAME = 'My research';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface PersistShape {
  projects: Project[];
  activeProjectId: string | null;
}

interface ProjectStore extends PersistShape {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  newProject: (name: string) => Project;
  selectProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

function makeProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: cleanName(name) || 'Untitled project',
    createdAt: now,
    updatedAt: now,
  };
}

const emptyShape = (): PersistShape => ({ projects: [], activeProjectId: null });

function normalizeShape(shape: Partial<PersistShape> | null | undefined): PersistShape {
  const projects = Array.isArray(shape?.projects)
    ? shape.projects.filter(
        (p): p is Project => !!p && typeof p.id === 'string' && typeof p.name === 'string',
      )
    : [];
  return {
    projects,
    activeProjectId: typeof shape?.activeProjectId === 'string' ? shape.activeProjectId : null,
  };
}

// Guarantees at least one project exists and activeProjectId points at a
// real one. Applied after every load so the rest of the app can assume a
// non-empty project list.
function ensureSeeded(shape: PersistShape): PersistShape {
  const projects = shape.projects.length > 0 ? shape.projects : [makeProject(SEED_PROJECT_NAME)];
  const activeProjectId = projects.some((p) => p.id === shape.activeProjectId)
    ? shape.activeProjectId
    : projects[0]!.id;
  return { projects, activeProjectId };
}

async function loadPersisted(): Promise<PersistShape> {
  try {
    return normalizeShape(await platform().storage.get<PersistShape>(STORAGE_KEY));
  } catch {
    return emptyShape();
  }
}

function persist(shape: PersistShape) {
  void platform()
    .storage.set<PersistShape>(STORAGE_KEY, shape)
    .catch((err: unknown) => {
      console.error('[projectStore] persist failed:', err);
    });
}

export const useProjectStore = create<ProjectStore>((set) => ({
  ...emptyShape(),
  hydrated: false,

  hydrate: async () => {
    const seeded = ensureSeeded(await loadPersisted());
    persist(seeded);
    set((state) => ({ ...state, ...seeded, hydrated: true }));
  },

  newProject: (name) => {
    const project = makeProject(name);
    set((state) => {
      const next: PersistShape = {
        projects: [project, ...state.projects],
        activeProjectId: project.id,
      };
      persist(next);
      return { ...state, ...next };
    });
    return project;
  },

  selectProject: (id) =>
    set((state) => {
      if (id === state.activeProjectId) return state;
      if (!state.projects.some((p) => p.id === id)) return state;
      persist({ projects: state.projects, activeProjectId: id });
      return { ...state, activeProjectId: id };
    }),

  renameProject: (id, name) =>
    set((state) => {
      const clean = cleanName(name);
      if (!clean) return state;
      const now = new Date().toISOString();
      const projects = state.projects.map((p) =>
        p.id === id ? { ...p, name: clean, updatedAt: now } : p,
      );
      persist({ projects, activeProjectId: state.activeProjectId });
      return { ...state, projects };
    }),

  deleteProject: (id) =>
    set((state) => {
      // Always keep at least one project so the app never has an empty
      // workspace list.
      if (state.projects.length <= 1) return state;
      if (!state.projects.some((p) => p.id === id)) return state;
      const projects = state.projects.filter((p) => p.id !== id);
      const activeProjectId =
        state.activeProjectId === id ? projects[0]!.id : state.activeProjectId;
      const next: PersistShape = { projects, activeProjectId };
      persist(next);
      return { ...state, ...next };
    }),
}));
