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
import { agentForRegion, type RegionId } from '@config/agents';
import { regionById } from '../data/regions';
import { onBrainFrame } from './brainFrames';

interface OverlayProps {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  containerRef: React.RefObject<HTMLDivElement>;
  // The rotating brain group. Region anchors are authored in the group's local
  // space, so we transform them by its world matrix each frame — otherwise the
  // label stays put while the brain auto-rotates underneath it.
  groupRef: React.MutableRefObject<THREE.Group | null>;
  hoveredRegion: RegionId | null;
  selectedRegion: RegionId | null;
}

const HOVER_DELAY_MS = 160;
// Keep the whole label box this many px clear of the canvas edges.
const EDGE_MARGIN = 10;
// The label box is shifted up by this many px in CSS (margin-top), so its
// rendered top edge sits above the transform anchor — account for it when
// clamping vertically so the box, not the anchor, stays on screen.
const LABEL_Y_OFFSET = 14;

// Project a group-local point to {x, y, visible} in container px, following the
// brain's live rotation/tilt via the group's world matrix.
function project(
  camera: THREE.Camera,
  group: THREE.Group | null,
  anchor: [number, number, number],
  width: number,
  height: number,
) {
  // The renderer refreshes these matrices during its render, which runs after
  // the frame callbacks; refresh them here so the label matches the frame being
  // drawn, including the last one before the scene goes still.
  group?.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(...anchor);
  if (group) v.applyMatrix4(group.matrixWorld);
  v.project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * width,
    y: (-v.y * 0.5 + 0.5) * height,
    visible: v.z > -1 && v.z < 1,
  };
}

// Clamp v into [lo, hi]; if the available span is smaller than the box itself
// (hi < lo), pin to lo so the box never escapes the leading edge.
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

export function BrainOverlay({ cameraRef, containerRef, groupRef, hoveredRegion, selectedRegion }: OverlayProps) {
  const [delayedHover, setDelayedHover] = useState<RegionId | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);

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

  const visibleId = delayedHover ?? selectedRegion;

  const region = visibleId ? regionById(visibleId) : null;

  // Follow the camera without forcing React to repaint. The label moves only
  // when the brain canvas draws a frame (camera moved, brain rotated, canvas
  // resized); while the scene is still, nothing is measured or written.
  useEffect(() => {
    if (!region) return;
    const update = () => {
      const camera = cameraRef.current;
      const container = containerRef.current;
      const label = labelRef.current;
      if (!camera || !container || !label) return;
      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      if (width === 0 || height === 0) {
        label.style.opacity = '0';
        return;
      }
      const pos = project(camera, groupRef.current, region.anchor, width, height);
      if (!pos.visible) {
        label.style.opacity = '0';
        return;
      }
      // Clamp the whole box — measured each frame so a late font/content
      // reflow can't reintroduce a cut-off — not just its anchor point.
      const boxW = label.offsetWidth;
      const boxH = label.offsetHeight;
      const clampedX = clamp(pos.x, EDGE_MARGIN, width - boxW - EDGE_MARGIN);
      const clampedY = clamp(
        pos.y,
        EDGE_MARGIN + LABEL_Y_OFFSET,
        height - boxH - EDGE_MARGIN + LABEL_Y_OFFSET,
      );
      label.style.opacity = '1';
      label.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
    };
    // Place it once now (the scene may already be still), then on every frame.
    const first = requestAnimationFrame(update);
    const off = onBrainFrame(update);
    return () => {
      cancelAnimationFrame(first);
      off();
    };
  }, [cameraRef, containerRef, groupRef, visibleId]);

  if (!region || !visibleId) return null;

  const agent = agentForRegion(visibleId);

  return (
    <div className="brain-overlay" aria-hidden="true">
      <div ref={labelRef} className="brain-label">
        <span className="brain-label-dot" style={{ background: region.emissive, boxShadow: `0 0 12px ${region.emissive}` }} />
        <div className="brain-label-body">
          <strong>{region.label}</strong>
          <span>{region.description}</span>
          {agent && <span className="brain-label-agent">{agent.label}</span>}
        </div>
      </div>
    </div>
  );
}
