// Screen-space label + tooltip overlay for the brain canvas.
//
// Why this is a 2D overlay instead of <Html> in the scene:
//   1. R3F's <Html distanceFactor> ties label size to scene depth — the
//      label grows or shrinks with zoom. Region labels need to read at
//      every zoom level, so we project anchors to screen coords each
//      frame and render plain HTML on top of the canvas.
//   2. Outside the WebGL render tree we never block frames, never fight
//      the EffectComposer, and never overlap the bloom pass.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { RegionId } from '@config/agents';
import { regionById } from '../data/regions';

interface OverlayProps {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  containerRef: React.RefObject<HTMLDivElement>;
  hoveredRegion: RegionId | null;
  selectedRegion: RegionId | null;
}

const HOVER_DELAY_MS = 160;

// Project a world-space point to {left, top, visible} in container px.
function project(camera: THREE.Camera, anchor: [number, number, number], width: number, height: number) {
  const v = new THREE.Vector3(...anchor).project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * width,
    y: (-v.y * 0.5 + 0.5) * height,
    visible: v.z > -1 && v.z < 1,
  };
}

export function BrainOverlay({ cameraRef, containerRef, hoveredRegion, selectedRegion }: OverlayProps) {
  const [, force] = useState(0);
  const [delayedHover, setDelayedHover] = useState<RegionId | null>(null);
  const hoverTimer = useRef<number | null>(null);

  // Repaint on every animation frame so labels track camera motion.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      force((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Debounce hover so labels don't strobe while the cursor sweeps.
  useEffect(() => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (!hoveredRegion) {
      setDelayedHover(null);
      return;
    }
    hoverTimer.current = window.setTimeout(() => setDelayedHover(hoveredRegion), HOVER_DELAY_MS);
    return () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    };
  }, [hoveredRegion]);

  const camera = cameraRef.current;
  const container = containerRef.current;
  if (!camera || !container) return null;
  const rect = container.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  if (width === 0 || height === 0) return null;

  const visibleId = delayedHover ?? selectedRegion;
  if (!visibleId) return null;
  const region = regionById(visibleId);
  const pos = project(camera, region.anchor, width, height);
  if (!pos.visible) return null;

  // Clamp inside the viewport so an off-screen region still surfaces a hint
  const clampedX = Math.min(Math.max(pos.x, 12), width - 12);
  const clampedY = Math.min(Math.max(pos.y, 12), height - 12);

  return (
    <div className="brain-overlay" aria-hidden="true">
      <div className="brain-label" style={{ transform: `translate3d(${clampedX}px, ${clampedY}px, 0)` }}>
        <span className="brain-label-dot" style={{ background: region.emissive, boxShadow: `0 0 12px ${region.emissive}` }} />
        <div className="brain-label-body">
          <strong>{region.label}</strong>
          <span>{region.description}</span>
        </div>
      </div>
    </div>
  );
}
