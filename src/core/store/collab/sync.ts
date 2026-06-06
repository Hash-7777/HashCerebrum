import * as Y from 'yjs';
import type { RagChunk } from '@core/rag';
import type { Manuscript, ManuscriptSection } from '@features/brain/swarm/manuscript';

export interface BrainAnnotation {
  id: string;
  projectId: string;
  regionId: string;
  text: string;
  createdAt: string;
  authorId: string;
}

const RAG_KEY = 'ragChunks';
const MANUSCRIPT_KEY = 'manuscript';
const ANNOTATIONS_KEY = 'annotations';

// --- RAG ---

export function setRagChunks(doc: Y.Doc, chunks: RagChunk[]): void {
  const arr = doc.getArray<RagChunk>(RAG_KEY);
  doc.transact(() => {
    arr.delete(0, arr.length);
    if (chunks.length > 0) {
      arr.push(chunks);
    }
  });
}

export function getRagChunks(doc: Y.Doc): RagChunk[] {
  return doc.getArray<RagChunk>(RAG_KEY).toArray();
}

export function observeRagChunks(doc: Y.Doc, callback: (chunks: RagChunk[]) => void): () => void {
  const arr = doc.getArray<RagChunk>(RAG_KEY);
  const handler = () => callback(arr.toArray());
  arr.observe(handler);
  return () => arr.unobserve(handler);
}

export function pushRagChunk(doc: Y.Doc, chunk: RagChunk): void {
  doc.getArray<RagChunk>(RAG_KEY).push([chunk]);
}

// --- Manuscript ---

export function setManuscript(doc: Y.Doc, manuscript: Manuscript): void {
  const map = doc.getMap<unknown>(MANUSCRIPT_KEY);
  doc.transact(() => {
    map.set('title', manuscript.title);
    map.set('abstract', { ...manuscript.abstract });
    map.set('keywords', [...manuscript.keywords]);
    const sectionsArr = new Y.Array<ManuscriptSection>();
    sectionsArr.push([...manuscript.sections]);
    map.set('sections', sectionsArr);
    if (manuscript.publication) {
      map.set('publication', manuscript.publication);
    } else {
      map.delete('publication');
    }
  });
}

export function getManuscript(doc: Y.Doc): Manuscript | null {
  const map = doc.getMap<unknown>(MANUSCRIPT_KEY);
  const title = map.get('title');
  if (typeof title !== 'string') return null;

  const abstractRaw = map.get('abstract');
  const abstract =
    typeof abstractRaw === 'object' && abstractRaw !== null
      ? (abstractRaw as Record<string, string>)
      : ({} as Record<string, string>);

  const keywordsRaw = map.get('keywords');
  const keywords = Array.isArray(keywordsRaw) ? (keywordsRaw as string[]) : [];

  const sectionsRaw = map.get('sections');
  const sections =
    sectionsRaw instanceof Y.Array
      ? (sectionsRaw as Y.Array<ManuscriptSection>).toArray()
      : [];

  const publicationRaw = map.get('publication');
  const publication =
    typeof publicationRaw === 'object' && publicationRaw !== null
      ? (publicationRaw as NonNullable<Manuscript['publication']>)
      : undefined;

  const result: Manuscript = {
    title,
    abstract: {
      background: abstract['background'] ?? '',
      objective: abstract['objective'] ?? '',
      methods: abstract['methods'] ?? '',
      results: abstract['results'] ?? '',
      conclusions: abstract['conclusions'] ?? '',
    },
    keywords,
    sections,
  };
  return {
    ...result,
    ...(publication !== undefined ? { publication } : {}),
  } as Manuscript;
}

export function observeManuscript(doc: Y.Doc, callback: (manuscript: Manuscript | null) => void): () => void {
  const map = doc.getMap<unknown>(MANUSCRIPT_KEY);
  const handler = () => callback(getManuscript(doc));
  map.observe(handler);
  return () => map.unobserve(handler);
}

// --- Annotations ---

export function setAnnotations(doc: Y.Doc, annotations: BrainAnnotation[]): void {
  const arr = doc.getArray<BrainAnnotation>(ANNOTATIONS_KEY);
  doc.transact(() => {
    arr.delete(0, arr.length);
    if (annotations.length > 0) {
      arr.push(annotations);
    }
  });
}

export function getAnnotations(doc: Y.Doc): BrainAnnotation[] {
  return doc.getArray<BrainAnnotation>(ANNOTATIONS_KEY).toArray();
}

export function observeAnnotations(doc: Y.Doc, callback: (annotations: BrainAnnotation[]) => void): () => void {
  const arr = doc.getArray<BrainAnnotation>(ANNOTATIONS_KEY);
  const handler = () => callback(arr.toArray());
  arr.observe(handler);
  return () => arr.unobserve(handler);
}

export function pushAnnotation(doc: Y.Doc, annotation: BrainAnnotation): void {
  doc.getArray<BrainAnnotation>(ANNOTATIONS_KEY).push([annotation]);
}

// --- Project state helpers ---

export interface ProjectSyncState {
  ragChunks: RagChunk[];
  manuscript: Manuscript | null;
  annotations: BrainAnnotation[];
}

export function getProjectSyncState(doc: Y.Doc): ProjectSyncState {
  return {
    ragChunks: getRagChunks(doc),
    manuscript: getManuscript(doc),
    annotations: getAnnotations(doc),
  };
}

export function setProjectSyncState(doc: Y.Doc, state: ProjectSyncState): void {
  doc.transact(() => {
    setRagChunks(doc, state.ragChunks);
    const manuscript = state.manuscript;
    if (manuscript) {
      setManuscript(doc, manuscript);
    } else {
      doc.getMap(MANUSCRIPT_KEY).clear();
    }
    setAnnotations(doc, state.annotations);
  });
}
