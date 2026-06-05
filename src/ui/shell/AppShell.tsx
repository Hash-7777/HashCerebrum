import { lazy, Suspense, useEffect, useState } from 'react';
import { MODES, type ModeId } from '@config/modes';
import { useModeStore } from '@core/store/modeStore';
import { useThemeStore, applyTheme } from '@core/store/themeStore';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { useProjectStore } from '@core/store/projectStore';
import { useRagStore } from '@core/store/ragStore';
import { usePeerReviewStore } from '@core/store/peerReviewStore';
import { warmupEmbeddings } from '@core/rag';
import { useAgentModelStore } from '@core/store/agentModelStore';
import { useAgentStore } from '@core/store/agentStore';
import { getModeComponent } from '@modes/registry';
import { ModeErrorBoundary } from '@modes/ModeErrorBoundary';
import { TitleBar } from './TitleBar';
import { LeftRail } from './LeftRail';
import { ExecutionTrace } from './ExecutionTrace';
import { Toast } from './Toast';
import { SettingsPanel } from '@features/brain/components/SettingsPanel';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const theme = useThemeStore((s) => s.theme);
  const refreshModels = useModelCatalogStore((s) => s.refreshAll);
  const hydrateResearchRuns = useResearchRunStore((s) => s.hydrate);
  const hydrateChats = useChatHistoryStore((s) => s.hydrate);
  const hydrateProjects = useProjectStore((s) => s.hydrate);
  const hydrateRag = useRagStore((s) => s.hydrate);
  const hydratePeerReview = usePeerReviewStore((s) => s.hydrate);
  const hydrateAgentModels = useAgentModelStore((s) => s.hydrate);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    void refreshModels();
    void hydrateResearchRuns();
    void hydrateRag();
    void hydratePeerReview();
    void warmupEmbeddings(); // begin loading the local embedding model early
    void hydrateAgentModels();
    // Projects must hydrate before chats so legacy chats with no projectId
    // can be adopted into the active project.
    void (async () => {
      await hydrateProjects();
      await hydrateChats(useProjectStore.getState().activeProjectId ?? undefined);
    })();
  }, [
    hydrateAgentModels,
    hydrateChats,
    hydrateProjects,
    hydrateRag,
    hydratePeerReview,
    hydrateResearchRuns,
    refreshModels,
  ]);

  useEffect(() => {
    const pushError = (source: string, message: string) => {
      useAgentStore.getState().push({ agentId: 'system', phase: 'error', detail: `${source}: ${message}` });
    };
    const onError = (event: ErrorEvent) => {
      pushError('window.onerror', event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const detail = event.reason instanceof Error ? event.reason.message : String(event.reason);
      pushError('unhandledrejection', detail);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // Global settings: listen for the hc:open-settings event dispatched by
  // the TitleBar button and the per-mode Settings button in the Composer.
  // ⌘, also toggles the panel from anywhere in the app.
  useEffect(() => {
    const onOpen = () => setSettingsOpen(true);
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen((v) => !v);
      } else if (event.key === 'Escape' && settingsOpen) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('hc:open-settings', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hc:open-settings', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

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
          {MODES.map((modeDef) => {
            const ModeView = getModeComponent(modeDef.id);
            return (
              <div key={modeDef.id} className="mode-host" hidden={modeDef.id !== mode}>
                <ModeErrorBoundary mode={modeDef.id} resetKey={modeDef.id}>
                  <Suspense fallback={<div className="mode mode-loading">Loading {modeDef.id}</div>}>
                    <ModeView />
                  </Suspense>
                </ModeErrorBoundary>
              </div>
            );
          })}
        </main>
      </div>
      <ExecutionTrace />
      <Toast />
      {settingsOpen && (
        <div
          className="settings-popover-layer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <SettingsPanel onClose={() => setSettingsOpen(false)} />
        </div>
      )}
    </div>
  );
}
