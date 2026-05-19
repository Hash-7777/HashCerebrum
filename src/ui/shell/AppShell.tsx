import { Suspense, useEffect } from 'react';
import { MODES, type ModeId } from '@config/modes';
import { useModeStore } from '@core/store/modeStore';
import { useResourcesStore } from '@core/store/resourcesStore';
import { useResearchRunStore } from '@core/store/researchRunStore';
import { getModeComponent } from '@modes/registry';
import { ModeErrorBoundary } from '@modes/ModeErrorBoundary';
import { TitleBar } from './TitleBar';
import { ModeRail } from './ModeRail';
import { ActivityLog } from './ActivityLog';

export function AppShell() {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);
  const hydrateResources = useResourcesStore((s) => s.hydrate);
  const hydrateResearchRuns = useResearchRunStore((s) => s.hydrate);
  const View = getModeComponent(mode);

  useEffect(() => {
    void hydrateResources();
    void hydrateResearchRuns();
  }, [hydrateResources, hydrateResearchRuns]);

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

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        <ModeRail />
        <main className="app-main">
          <ModeErrorBoundary mode={mode} resetKey={mode}>
            <Suspense fallback={<div className="mode mode-loading">Loading {mode}</div>}>
              <View />
            </Suspense>
          </ModeErrorBoundary>
        </main>
        <ActivityLog />
      </div>
    </div>
  );
}
