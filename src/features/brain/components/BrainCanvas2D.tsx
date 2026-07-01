import { memo, useMemo } from 'react';
import { agentById, agentForRegion, type RegionId } from '@config/agents';
import { regionById } from '../data/regions';
import type { AgentStatus, AgentRunState } from './AgentPanel';

// A GPU-free 2D stand-in for the 3D BrainCanvas, shown in Lite mode. It mirrors
// the 3D scene's behaviour — each anatomical region glows in its own colour when
// the agent bound to it is active — using only inline SVG (no three.js, no WebGL,
// no GLB). All region visuals are driven by SVG presentation attributes (fill /
// opacity / filter) and CSS classes, never inline `style` attributes, so the
// nonce'd Tauri CSP cannot strip them.

// Region state resolves from the bound agent's run state (idle regions stay dim
// ambient decoration; a running agent's region pulses and glows).
function regionState(regionId: RegionId, byRegion: Map<RegionId, AgentRunState>): AgentRunState {
  return byRegion.get(regionId) ?? 'idle';
}

// Base opacity per state; the `is-running` class layers a CSS pulse on top.
const STATE_OPACITY: Record<AgentRunState, number> = {
  running: 0.92,
  done: 0.5,
  error: 0.55,
  idle: 0.16,
};

function useRegionStates(statuses: AgentStatus[]): Map<RegionId, AgentRunState> {
  return useMemo(() => {
    const map = new Map<RegionId, AgentRunState>();
    for (const status of statuses) {
      const region = agentById(status.agentId).regionBinding;
      // If two agents share a region, the more active state wins.
      const rank: Record<AgentRunState, number> = { idle: 0, done: 1, error: 2, running: 3 };
      const prev = map.get(region);
      if (!prev || rank[status.state] > rank[prev]) map.set(region, status.state);
    }
    return map;
  }, [statuses]);
}

interface RegionShapeProps {
  regionId: RegionId;
  state: AgentRunState;
  children: React.ReactNode;
}

// One region: applies its colour (fill) and a state-driven opacity/glow. The
// bound agent's label is exposed as an accessible <title> for the region group.
function RegionShape({ regionId, state, children }: RegionShapeProps) {
  const region = regionById(regionId);
  const agent = agentForRegion(regionId);
  const running = state === 'running';
  const title = agent ? `${region.label} · ${agent.label}` : region.label;
  return (
    <g
      className={`brain2d-region${running ? ' is-running' : ''}`}
      fill={region.emissive}
      opacity={STATE_OPACITY[state]}
      {...(running ? { filter: 'url(#brain2d-glow)' } : {})}
    >
      <title>{title}</title>
      {children}
    </g>
  );
}

export const BrainCanvas2D = memo(function BrainCanvas2D({ statuses }: { statuses: AgentStatus[] }) {
  const byRegion = useRegionStates(statuses);
  const st = (id: RegionId) => regionState(id, byRegion);

  return (
    <div className="brain2d" aria-label="2D brain — active regions light per running agent">
      <svg viewBox="0 0 640 470" className="brain2d-svg" role="img" xmlns="http://www.w3.org/2000/svg">
        <title>Anatomical brain — regions glow per active agent</title>
        <desc>Sagittal brain silhouette; each lobe or deep structure glows in its region colour when its bound agent is running.</desc>
        <defs>
          <filter id="brain2d-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="brain2d-clip">
            <path d="M130 260 C130 150 230 80 360 78 C480 76 590 125 598 210 C604 275 565 315 525 326 C540 332 546 352 532 364 C568 370 592 390 586 416 C578 446 536 460 500 458 C450 455 432 430 432 430 C280 446 130 390 130 260 Z" />
          </clipPath>
        </defs>

        {/* Cerebrum lobes, clipped to the silhouette */}
        <g clipPath="url(#brain2d-clip)">
          <rect x="100" y="50" width="520" height="440" fill="#121a28" opacity="1" />
          <RegionShape regionId="frontal" state={st('frontal')}>
            <path d="M130 260 C130 160 220 88 320 82 L340 260 C280 290 180 300 130 260 Z" />
          </RegionShape>
          <RegionShape regionId="parietal" state={st('parietal')}>
            <path d="M320 82 C410 80 480 110 500 170 L450 260 L340 260 Z" />
          </RegionShape>
          <RegionShape regionId="occipital" state={st('occipital')}>
            <path d="M500 170 C540 135 590 150 596 210 C600 260 568 300 525 316 L450 260 Z" />
          </RegionShape>
          <RegionShape regionId="temporal" state={st('temporal')}>
            <path d="M180 300 C240 316 340 310 450 260 L500 340 C450 390 300 400 215 365 C185 352 170 320 180 300 Z" />
          </RegionShape>
          {/* Sulci hint lines sit above the lobes but inside the clip */}
          <g stroke="#0a0e15" strokeWidth={2.4} fill="none" opacity={0.45} strokeLinecap="round">
            <path d="M190 160 q30 24 8 54" />
            <path d="M250 125 q26 30 4 66" />
            <path d="M330 110 q10 40 -6 74" />
            <path d="M410 120 q0 40 -20 78" />
            <path d="M480 160 q-6 40 -34 70" />
          </g>
        </g>

        {/* Cerebellum */}
        <RegionShape regionId="cerebellum" state={st('cerebellum')}>
          <path d="M528 332 C572 338 596 362 590 390 C582 422 540 436 502 434 C466 431 450 412 454 390 C458 364 492 344 528 332 Z" />
          <g stroke="#0a0e15" strokeWidth={2} fill="none" opacity={0.5}>
            <path d="M480 360 h96" />
            <path d="M476 378 h108" />
            <path d="M484 396 h92" />
          </g>
        </RegionShape>
        {/* Brainstem */}
        <RegionShape regionId="brainstem" state={st('brainstem')}>
          <path d="M432 430 C432 430 450 412 454 390 L480 412 C478 446 450 472 428 480 C418 460 422 444 432 430 Z" />
        </RegionShape>

        {/* Deep structures as inner nodes */}
        <RegionShape regionId="thalamus" state={st('thalamus')}>
          <circle cx={372} cy={232} r={15} />
        </RegionShape>
        <RegionShape regionId="basal_ganglia" state={st('basal_ganglia')}>
          <circle cx={332} cy={212} r={13} />
        </RegionShape>
        <RegionShape regionId="hippocampus" state={st('hippocampus')}>
          <path d="M386 260 q22 6 20 30 q-2 16 -20 14 q6 -22 0 -44 Z" />
        </RegionShape>
        <RegionShape regionId="amygdala" state={st('amygdala')}>
          <circle cx={372} cy={290} r={10} />
        </RegionShape>

        {/* Silhouette outline */}
        <path
          d="M130 260 C130 150 230 80 360 78 C480 76 590 125 598 210 C604 275 565 315 525 326 C540 332 546 352 532 364 C568 370 592 390 586 416 C578 446 536 460 500 458 C450 455 432 430 432 430 C280 446 130 390 130 260 Z"
          fill="none"
          stroke="#33405a"
          strokeWidth={1.6}
        />
      </svg>
    </div>
  );
});
