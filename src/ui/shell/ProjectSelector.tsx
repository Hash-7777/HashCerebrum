// Top of the left rail — switch, create, rename, and delete projects.
// A project scopes its saved chats (and, from Phase 28b, its RAG store).

import { useState, type FormEvent } from 'react';
import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { useProjectStore } from '@core/store/projectStore';
import { useRagStore } from '@core/store/ragStore';
import { Icon } from '@ui/icons';

type EditMode = 'idle' | 'create' | 'rename';

export function ProjectSelector() {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const newProject = useProjectStore((s) => s.newProject);
  const selectProject = useProjectStore((s) => s.selectProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);

  const [mode, setMode] = useState<EditMode>('idle');
  const [draft, setDraft] = useState('');

  const active = projects.find((p) => p.id === activeProjectId) ?? null;
  const canDelete = projects.length > 1;

  const startCreate = () => {
    setDraft('');
    setMode('create');
  };

  const startRename = () => {
    if (!active) return;
    setDraft(active.name);
    setMode('rename');
  };

  const cancel = () => {
    setMode('idle');
    setDraft('');
  };

  const submitDraft = (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (value) {
      if (mode === 'create') newProject(value);
      else if (mode === 'rename' && active) renameProject(active.id, value);
    }
    cancel();
  };

  const handleDelete = () => {
    if (!active || !canDelete) return;
    const ok = window.confirm(
      `Delete project "${active.name}"? Its saved chats and research memory will be removed. This cannot be undone.`,
    );
    if (!ok) return;
    // Cascade: drop the project's chats and RAG memory first, then the
    // project itself.
    useChatHistoryStore.getState().deleteChatsForProject(active.id);
    useRagStore.getState().clearProject(active.id);
    deleteProject(active.id);
  };

  return (
    <div className="project-rail" aria-label="Project">
      <header className="project-rail-head">
        <span>Project</span>
      </header>
      {mode === 'idle' ? (
        <div className="project-rail-row">
          <select
            className="project-rail-select"
            value={activeProjectId ?? ''}
            onChange={(event) => selectProject(event.target.value)}
            aria-label="Active project"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="project-rail-btn"
            onClick={startCreate}
            title="New project"
            aria-label="New project"
          >
            <Icon name="plus" size={13} />
          </button>
          <button
            type="button"
            className="project-rail-btn"
            onClick={startRename}
            disabled={!active}
            title="Rename project"
            aria-label="Rename project"
          >
            <Icon name="document" size={13} />
          </button>
          <button
            type="button"
            className="project-rail-btn project-rail-btn-danger"
            onClick={handleDelete}
            disabled={!canDelete}
            title={canDelete ? 'Delete project' : 'The last project cannot be deleted'}
            aria-label="Delete project"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ) : (
        <form className="project-rail-form" onSubmit={submitDraft}>
          <input
            className="project-rail-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancel();
            }}
            placeholder={mode === 'create' ? 'New project name' : 'Rename project'}
            maxLength={60}
            autoFocus
          />
          <button type="submit" className="project-rail-btn" aria-label="Save project name">
            <Icon name="check" size={13} />
          </button>
        </form>
      )}
    </div>
  );
}
