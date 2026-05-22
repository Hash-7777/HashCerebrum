import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'hc.review.v1';

export interface SavedAssessment {
  id: string;
  projectId: string;
  tool: 'rob2' | 'robins-i' | 'quadas2' | 'grade';
  studyTitle: string;
  createdAt: string;
  payload: unknown;
}

function loadAll(): SavedAssessment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is SavedAssessment =>
        !!a &&
        typeof (a as SavedAssessment).id === 'string' &&
        typeof (a as SavedAssessment).projectId === 'string',
    );
  } catch {
    return [];
  }
}

function saveAll(assessments: SavedAssessment[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(assessments));
  } catch {
    // Storage quota exceeded or private mode
  }
}

export function useReviewStorage(projectId: string | null) {
  const [assessments, setAssessments] = useState<SavedAssessment[]>([]);

  useEffect(() => {
    setAssessments(loadAll().filter((a) => a.projectId === projectId));
  }, [projectId]);

  const save = useCallback(
    (tool: SavedAssessment['tool'], studyTitle: string, payload: unknown) => {
      if (!projectId) return;
      const all = loadAll();
      const next: SavedAssessment = {
        id: crypto.randomUUID(),
        projectId,
        tool,
        studyTitle: studyTitle || '(untitled)',
        createdAt: new Date().toISOString(),
        payload,
      };
      const filtered = all.filter((a) => !(a.projectId === projectId && a.studyTitle === next.studyTitle && a.tool === tool));
      const updated = [...filtered, next];
      saveAll(updated);
      setAssessments(updated.filter((a) => a.projectId === projectId));
    },
    [projectId],
  );

  const remove = useCallback(
    (id: string) => {
      const all = loadAll().filter((a) => a.id !== id);
      saveAll(all);
      setAssessments(all.filter((a) => a.projectId === projectId));
    },
    [projectId],
  );

  return { assessments, save, remove };
}
