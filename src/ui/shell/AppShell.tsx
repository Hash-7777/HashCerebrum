import { Suspense } from 'react';
import { useModeStore } from '@core/store/modeStore';
import { getModeComponent } from '@modes/registry';
import { ModeErrorBoundary } from '@modes/ModeErrorBoundary';
import { TitleBar } from './TitleBar';
import { ModeRail } from './ModeRail';
import { ActivityLog } from './ActivityLog';

export function AppShell() {
  const mode = useModeStore((s) => s.mode);
  const View = getModeComponent(mode);

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
