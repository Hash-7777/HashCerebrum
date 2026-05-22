import { useCallback, useEffect, useState } from 'react';

export type AssessmentTool = 'rob2' | 'robins-i' | 'quadas2' | 'grade' | 'protocol';

export interface SavedAssessment {
  id: string;
  projectId: string;
  tool: AssessmentTool;
  studyTitle: string;
  createdAt: string;
  payload: unknown;
}

function loadAll(key: string): SavedAssessment[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is SavedAssessment =>
        !!a &&
        typeof (a as SavedAssessment).id === 'string' &&
        typeof (a as SavedAssessment).projectId === 'string' &&
        typeof (a as SavedAssessment).tool === 'string',
    );
  } catch {
    return [];
  }
}

function saveAll(key: string, assessments: SavedAssessment[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(assessments));
    return true;
  } catch {
    // Storage quota exceeded or private mode
    return false;
  }
}

export function useReviewStorage(projectId: string | null, namespace = 'review') {
  const storageKey = `hc.${namespace}.v1`;
  const [assessments, setAssessments] = useState<SavedAssessment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAssessments(loadAll(storageKey).filter((a) => a.projectId === projectId));
    setError(null);
  }, [projectId, storageKey]);

  const save = useCallback(
    (tool: AssessmentTool, studyTitle: string, payload: unknown) => {
      if (!projectId) {
        setError('no active project');
        return false;
      }
      setError(null);
      const all = loadAll(storageKey);
      const next: SavedAssessment = {
        id: crypto.randomUUID(),
        projectId,
        tool,
        studyTitle: studyTitle || '(untitled)',
        createdAt: new Date().toISOString(),
        payload,
      };
      // Keep existing items; do not silently overwrite duplicates.
      const updated = [...all, next];
      if (!saveAll(storageKey, updated)) {
        setError('save failed — storage may be full');
        return false;
      }
      setAssessments(updated.filter((a) => a.projectId === projectId));
      return true;
    },
    [projectId, storageKey],
  );

  const remove = useCallback(
    (id: string) => {
      const all = loadAll(storageKey).filter((a) => a.id !== id);
      saveAll(storageKey, all);
      setAssessments(all.filter((a) => a.projectId === projectId));
    },
    [projectId, storageKey],
  );

  return { assessments, save, remove, error };
}
