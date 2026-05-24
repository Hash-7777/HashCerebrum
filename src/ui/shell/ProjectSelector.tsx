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
  const [pickerOpen, setPickerOpen] = useState(false);

  const active = projects.find((p) => p.id === activeProjectId) ?? null;
  const canDelete = projects.length > 1;

  const chatCount = useChatHistoryStore((s) =>
    s.chats.filter((c) => c.projectId === activeProjectId).length,
  );
  const ragCount = useRagStore((s) =>
    activeProjectId ? s.chunksForProject(activeProjectId).length : 0,
  );

  const startCreate = () => { setDraft(''); setMode('create'); setPickerOpen(false); };
  const startRename = () => { if (!active) return; setDraft(active.name); setMode('rename'); setPickerOpen(false); };
  const cancel = () => { setMode('idle'); setDraft(''); };

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
      `Delete project "${active.name}"? Its saved chats and research memory will be removed.`,
    );
    if (!ok) return;
    useChatHistoryStore.getState().deleteChatsForProject(active.id);
    useRagStore.getState().clearProject(active.id);
    deleteProject(active.id);
  };

  if (mode !== 'idle') {
    return (
      <div className="proj">
        <form className="proj-edit-form" onSubmit={submitDraft}>
          <input
            className="proj-edit-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
            placeholder={mode === 'create' ? 'New project name' : 'Rename project'}
            maxLength={60}
            autoFocus
          />
          <button type="submit" className="icon-btn compact" aria-label="Save">
            <Icon name="check" size={13} />
          </button>
          <button type="button" className="icon-btn compact" onClick={cancel} aria-label="Cancel">
            <Icon name="close" size={13} />
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="proj">
      <button
        className="proj-picker"
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        aria-label="Switch project"
      >
        <div className="proj-row">
          <div className="proj-label-mini">Project</div>
          <span className="proj-stats-inline">{chatCount} · {ragCount}</span>
        </div>
        <div className="proj-name">
          <span className="proj-title">{active?.name ?? 'No project'}</span>
          <Icon name="chevDown" size={13} />
        </div>
        <div className="proj-domain">Research workspace</div>
      </button>

      {pickerOpen && (
        <div className="proj-dropdown">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`proj-option${project.id === activeProjectId ? ' active' : ''}`}
              onClick={() => { selectProject(project.id); setPickerOpen(false); }}
            >
              {project.name}
            </button>
          ))}
          <div className="proj-dropdown-sep" />
          <button type="button" className="proj-option proj-option-action" onClick={startCreate}>
            <Icon name="plus" size={12} /> New project
          </button>
          {active && (
            <button type="button" className="proj-option proj-option-action" onClick={startRename}>
              <Icon name="edit" size={12} /> Rename
            </button>
          )}
          {canDelete && (
            <button type="button" className="proj-option proj-option-danger" onClick={handleDelete}>
              <Icon name="close" size={12} /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
