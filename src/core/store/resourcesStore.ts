// Resources store — saved evidence items, tags, notes. The same state
// shape is persisted through the platform storage adapter: Tauri Store
// in the desktop shell, localStorage in browser dev.

import { create } from 'zustand';
import type { EvidenceItem } from '@platform/index';
import { platform } from '@platform/index';

const STORAGE_KEY = 'resources.v1';
const LEGACY_LOCAL_STORAGE_KEY = 'hc.resources.v1';

export interface SavedResource {
  id: string;
  savedAt: string;
  collectionId: string;
  tags: string[];
  notes: string;
  evidence: EvidenceItem;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
}

interface PersistShape {
  resources: SavedResource[];
  collections: Collection[];
}

interface ResourcesStore extends PersistShape {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (evidence: EvidenceItem, collectionId?: string) => SavedResource | null;
  remove: (id: string) => void;
  updateNotes: (id: string, notes: string) => void;
  toggleTag: (id: string, tag: string) => void;
  moveTo: (id: string, collectionId: string) => void;
  createCollection: (name: string) => Collection;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;
}

const defaultCollection: Collection = {
  id: 'inbox',
  name: 'Inbox',
  createdAt: new Date(0).toISOString(),
};

const emptyShape = (): PersistShape => ({ resources: [], collections: [defaultCollection] });

function normalizeShape(shape: Partial<PersistShape> | null | undefined): PersistShape {
  return {
    resources: Array.isArray(shape?.resources) ? shape.resources : [],
    collections:
      Array.isArray(shape?.collections) && shape.collections.length > 0
        ? shape.collections
        : [defaultCollection],
  };
}

function mergeShapes(disk: PersistShape, current: PersistShape): PersistShape {
  const collectionIds = new Set<string>();
  const collections = [...disk.collections, ...current.collections].filter((collection) => {
    if (collectionIds.has(collection.id)) return false;
    collectionIds.add(collection.id);
    return true;
  });

  const resourceKeys = new Set<string>();
  const resources = [...current.resources, ...disk.resources].filter((resource) => {
    const key = evidenceKey(resource.evidence);
    if (resourceKeys.has(key)) return false;
    resourceKeys.add(key);
    return true;
  });

  return { resources, collections: collections.length > 0 ? collections : [defaultCollection] };
}

function loadLegacyLocalStorage(): PersistShape | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistShape>;
    return normalizeShape(parsed);
  } catch (error) {
    console.warn('[resourcesStore] Failed to load legacy localStorage:', error);
    return null;
  }
}

async function loadPersisted(): Promise<PersistShape> {
  try {
    const stored = await platform().storage.get<PersistShape>(STORAGE_KEY);
    if (stored) return normalizeShape(stored);
    return loadLegacyLocalStorage() ?? emptyShape();
  } catch (error) {
    console.warn('[resourcesStore] Failed to load persisted resources:', error);
    return loadLegacyLocalStorage() ?? emptyShape();
  }
}

function persist(shape: PersistShape) {
  void platform()
    .storage.set(STORAGE_KEY, shape)
    .catch((err: unknown) => {
      console.error('[resourcesStore] persist failed:', err);
    });
}

function evidenceKey(evidence: EvidenceItem): string {
  return (
    evidence.url ||
    evidence.identifiers?.pmid ||
    evidence.identifiers?.doi ||
    evidence.provenanceHash ||
    `${evidence.source}-${evidence.title}`
  );
}

export const useResourcesStore = create<ResourcesStore>((set, get) => {
  const initial = emptyShape();
  return {
    ...initial,
    hydrated: false,
    hydrate: async () => {
      const disk = await loadPersisted();
      set((state) => {
        const next = mergeShapes(disk, { resources: state.resources, collections: state.collections });
        persist(next);
        return { ...state, ...next, hydrated: true };
      });
    },
    add: (evidence, collectionId = 'inbox') => {
      const dedupe = evidenceKey(evidence);
      const existing = get().resources.find((r) => evidenceKey(r.evidence) === dedupe);
      if (existing) return null;
      const saved: SavedResource = {
        id: crypto.randomUUID(),
        savedAt: new Date().toISOString(),
        collectionId,
        tags: [],
        notes: '',
        evidence,
      };
      set((state) => {
        const next = { ...state, resources: [saved, ...state.resources] };
        persist({ resources: next.resources, collections: next.collections });
        return next;
      });
      return saved;
    },
    remove: (id) =>
      set((state) => {
        const next = { ...state, resources: state.resources.filter((r) => r.id !== id) };
        persist({ resources: next.resources, collections: next.collections });
        return next;
      }),
    updateNotes: (id, notes) =>
      set((state) => {
        const next = {
          ...state,
          resources: state.resources.map((r) => (r.id === id ? { ...r, notes } : r)),
        };
        persist({ resources: next.resources, collections: next.collections });
        return next;
      }),
    toggleTag: (id, tag) =>
      set((state) => {
        const clean = tag.trim().toLowerCase();
        if (!clean) return state;
        const next = {
          ...state,
          resources: state.resources.map((r) =>
            r.id === id
              ? { ...r, tags: r.tags.includes(clean) ? r.tags.filter((t) => t !== clean) : [...r.tags, clean] }
              : r,
          ),
        };
        persist({ resources: next.resources, collections: next.collections });
        return next;
      }),
    moveTo: (id, collectionId) =>
      set((state) => {
        if (!state.collections.some((c) => c.id === collectionId)) return state;
        const next = {
          ...state,
          resources: state.resources.map((r) => (r.id === id ? { ...r, collectionId } : r)),
        };
        persist({ resources: next.resources, collections: next.collections });
        return next;
      }),
    createCollection: (name) => {
      const collection: Collection = {
        id: crypto.randomUUID(),
        name: name.trim() || 'Untitled collection',
        createdAt: new Date().toISOString(),
      };
      set((state) => {
        const next = { ...state, collections: [...state.collections, collection] };
        persist({ resources: next.resources, collections: next.collections });
        return next;
      });
      return collection;
    },
    renameCollection: (id, name) =>
      set((state) => {
        if (id === 'inbox') return state; // Inbox name is fixed
        const clean = name.trim();
        if (!clean) return state;
        const next = {
          ...state,
          collections: state.collections.map((c) => (c.id === id ? { ...c, name: clean } : c)),
        };
        persist({ resources: next.resources, collections: next.collections });
        return next;
      }),
    deleteCollection: (id) =>
      set((state) => {
        if (id === 'inbox') return state;
        const next = {
          ...state,
          collections: state.collections.filter((c) => c.id !== id),
          resources: state.resources.map((r) =>
            r.collectionId === id ? { ...r, collectionId: 'inbox' } : r,
          ),
        };
        persist({ resources: next.resources, collections: next.collections });
        return next;
      }),
  };
});

// Export helpers — exposed here rather than in the component so a
// future CLI/export command can reuse them.
export function exportMarkdown(resources: SavedResource[], collectionName: string): string {
  const lines: string[] = [`# ${collectionName}`, '', `${resources.length} saved record${resources.length === 1 ? '' : 's'}.`, ''];
  for (const r of resources) {
    const e = r.evidence;
    lines.push(`## ${e.title}`);
    lines.push('');
    const meta: string[] = [];
    if (e.year) meta.push(String(e.year));
    if (e.source) meta.push(e.source.toUpperCase());
    if (e.authors?.length) meta.push(e.authors.slice(0, 4).join(', '));
    if (meta.length) lines.push(`*${meta.join(' · ')}*`);
    if (e.snippet) {
      lines.push('');
      lines.push(`> ${e.snippet.replace(/\n+/g, ' ')}`);
    }
    if (e.url) {
      lines.push('');
      lines.push(`<${e.url}>`);
    }
    if (r.tags.length) {
      lines.push('');
      lines.push(r.tags.map((t) => `\`${t}\``).join(' '));
    }
    if (r.notes.trim()) {
      lines.push('');
      lines.push('### Notes');
      lines.push('');
      lines.push(r.notes.trim());
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

export function exportBibtex(resources: SavedResource[]): string {
  const lines: string[] = [];
  for (const r of resources) {
    const e = r.evidence;
    const key = (e.identifiers?.pmid || e.identifiers?.doi || e.provenanceHash || r.id).replace(/[^A-Za-z0-9_-]/g, '_');
    lines.push(`@article{${key},`);
    lines.push(`  title = {${e.title.replace(/[{}]/g, '')}},`);
    if (e.authors?.length) lines.push(`  author = {${e.authors.join(' and ')}},`);
    if (e.year) lines.push(`  year = {${e.year}},`);
    if (e.identifiers?.doi) lines.push(`  doi = {${e.identifiers.doi}},`);
    if (e.url) lines.push(`  url = {${e.url}},`);
    lines.push(`  note = {Source: ${e.source}},`);
    lines.push(`}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function formatCitation(resource: SavedResource): string {
  const e = resource.evidence;
  const parts: string[] = [];
  if (e.authors?.length) parts.push(e.authors.slice(0, 4).join(', ') + (e.authors.length > 4 ? ' et al.' : ''));
  if (e.year) parts.push(`(${e.year})`);
  parts.push(e.title);
  parts.push(`${e.source.toUpperCase()}.`);
  if (e.url) parts.push(e.url);
  else if (e.identifiers?.doi) parts.push(`https://doi.org/${e.identifiers.doi}`);
  else if (e.identifiers?.pmid) parts.push(`https://pubmed.ncbi.nlm.nih.gov/${e.identifiers.pmid}/`);
  return parts.join(' ');
}

export function exportCslJson(resources: SavedResource[]): string {
  return JSON.stringify(
    resources.map((r) => {
      const e = r.evidence;
      const out: Record<string, unknown> = {
        id: r.id,
        type: e.source === 'ctgov' ? 'report' : 'article-journal',
        title: e.title,
        URL: e.url ?? undefined,
        DOI: e.identifiers?.doi,
        PMID: e.identifiers?.pmid,
        issued: e.year ? { 'date-parts': [[Number(e.year)]] } : undefined,
        author: e.authors?.length
          ? e.authors.map((name) => ({ literal: name }))
          : undefined,
        note: r.notes || undefined,
        keyword: r.tags.length ? r.tags.join(', ') : undefined,
      };
      Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
      return out;
    }),
    null,
    2,
  );
}
