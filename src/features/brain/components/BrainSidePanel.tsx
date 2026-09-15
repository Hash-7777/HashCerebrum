// The workspace's right-hand side: the live 3D brain above the agent panel, or
// in Lite mode a 2D pipeline workflow in its place, so weak or GPU-less
// hardware runs the same research with no WebGL at all.

import { lazy, Suspense } from 'react';
import type { RegionId } from '@config/agents';
import { FeatureBoundary } from '@ui/errors/FeatureBoundary';
import { AgentPanel, type AgentStatus } from './AgentPanel';
import { BrainWorkflow2D, type WorkflowIntent } from './BrainWorkflow2D';
import { BRAIN_MODEL } from '../data/modelParts';

// Lazy so the heavy three.js / WebGL bundle and the 3D brain model load ONLY
// when the canvas is actually rendered — never in Lite mode or on weak hardware.
const BrainCanvas = lazy(() =>
  import('./BrainCanvas').then((m) => ({ default: m.BrainCanvas })),
);

export function BrainSidePanel({
  lite,
  agentStatuses,
  activeIntent,
  selectedRegion,
  hoveredRegion,
  toggleRegion,
  setHoveredRegion,
}: {
  lite: boolean;
  agentStatuses: AgentStatus[];
  activeIntent: WorkflowIntent;
  selectedRegion: RegionId | null;
  hoveredRegion: RegionId | null;
  toggleRegion: (region: RegionId | null) => void;
  setHoveredRegion: (region: RegionId | null) => void;
}) {
  return (
    <section className={`brain-side${lite ? ' brain-side--solo' : ''}`}>
      {lite ? (
        // Lite mode: no WebGL / 3D — a 2D pipeline workflow shows the live
        // research process (rail slides to the active stage) above the agent
        // panel, so weak or no-GPU hardware runs full-speed with no loss.
        <>
          <FeatureBoundary name="Pipeline (2D)">
            <div className="brain-model-panel brain-model-panel--flat">
              <BrainWorkflow2D statuses={agentStatuses} intent={activeIntent} />
            </div>
          </FeatureBoundary>
          <FeatureBoundary name="Agents">
            <AgentPanel statuses={agentStatuses} />
          </FeatureBoundary>
        </>
      ) : (
        <>
          <FeatureBoundary name="Brain canvas" resetKey={BRAIN_MODEL.path}>
            <div className="brain-model-panel">
              <div className="brain-stage">
                <Suspense
                  fallback={
                    <div className="brain-loading" role="status" aria-live="polite">
                      <span className="brain-loading-orb" aria-hidden="true" />
                      <p className="brain-loading-label">Preparing the 3D brain…</p>
                    </div>
                  }
                >
                  <BrainCanvas
                    selectedRegion={selectedRegion}
                    hoveredRegion={hoveredRegion}
                    onSelectRegion={toggleRegion}
                    onHoverRegion={setHoveredRegion}
                  />
                </Suspense>
                <p className="brain-credit-line">
                  {BRAIN_MODEL.source} · {BRAIN_MODEL.license}
                </p>
              </div>
            </div>
          </FeatureBoundary>

          <div className="source-panel">
            <FeatureBoundary name="Agents">
              <AgentPanel statuses={agentStatuses} />
            </FeatureBoundary>
          </div>
        </>
      )}
    </section>
  );
}
