import { lazy, Suspense, useEffect } from 'react';
import { MODES, type ModeId } from '@config/modes';
import { useModeStore } from '@core/store/modeStore';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useResourcesStore } from '@core/store/resourcesStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { useProjectStore } from '@core/store/projectStore';
import { getModeComponent } from '@modes/registry';
import { ModeErrorBoundary } from '@modes/ModeErrorBoundary';
import { TitleBar } from './TitleBar';
import { LeftRail } from './LeftRail';
import { ExecutionTrace } from './ExecutionTrace';

const RegionBindingEditor = lazy(() =>
  import('@features/brain/components/RegionBindingEditor').then((module) => ({
    default: module.RegionBindingEditor,
  })),
);

// Dev-only tools are reached via ?dev=<tool>. The import.meta.env.DEV
// guard means a production build never renders them, so the lazy chunk
// is emitted but never fetched.
function activeDevTool(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    return new URLSearchParams(window.location.search).get('dev');
  } catch {
    return null;
  }
}

export function AppShell() {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  const refreshModels = useModelCatalogStore((s) => s.refreshAll);
  const hydrateResources = useResourcesStore((s) => s.hydrate);
  const hydrateResearchRuns = useResearchRunStore((s) => s.hydrate);
  const hydrateChats = useChatHistoryStore((s) => s.hydrate);
  const hydrateProjects = useProjectStore((s) => s.hydrate);
  const View = getModeComponent(mode);

  useEffect(() => {
    void refreshModels();
    void hydrateResources();
    void hydrateResearchRuns();
    // Projects must hydrate before chats so legacy chats with no projectId
    // can be adopted into the active project.
    void (async () => {
      await hydrateProjects();
      await hydrateChats(useProjectStore.getState().activeProjectId ?? undefined);
    })();
  }, [hydrateChats, hydrateProjects, hydrateResources, hydrateResearchRuns, refreshModels]);

  // Cmd/Ctrl+1..5 jumps modes. The shortcut shown on each rail button
  // reflects this binding (⌘1, ⌘2, …).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const idx = Number(event.key);
      if (Number.isInteger(idx) && idx >= 1 && idx <= MODES.length) {
        event.preventDefault();
        const next = MODES[idx - 1]!.id as ModeId;
        setMode(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMode]);

  if (activeDevTool() === 'bindings') {
    return (
      <Suspense fallback={<div className="mode mode-loading">Loading region editor</div>}>
        <RegionBindingEditor />
      </Suspense>
    );
  }

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        <LeftRail />
        <main className="app-main">
          <ModeErrorBoundary mode={mode} resetKey={mode}>
            <Suspense fallback={<div className="mode mode-loading">Loading {mode}</div>}>
              <View />
            </Suspense>
          </ModeErrorBoundary>
        </main>
      </div>
      <ExecutionTrace />
    </div>
  );
}
