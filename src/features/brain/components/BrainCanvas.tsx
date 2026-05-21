import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Bloom, EffectComposer, Outline, Selection, Select, Vignette } from '@react-three/postprocessing';
import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { RegionId } from '@config/agents';
import { useBrainStore } from '@core/store/brainStore';
import { Icon } from '@ui/icons';
import { BRAIN_MODEL, PARTS_BY_NODE, primaryRegionForPart, type BrainModelPart } from '../data/modelParts';
import { regionById } from '../data/regions';
import { BrainOverlay } from './BrainOverlay';

interface BrainCanvasProps {
  selectedRegion: RegionId | null;
  hoveredRegion: RegionId | null;
  onSelectRegion: (region: RegionId | null) => void;
  onHoverRegion: (region: RegionId | null) => void;
}

interface BrainMeshPart {
  part: BrainModelPart;
  geometry: THREE.BufferGeometry;
  baseMaterial: THREE.MeshStandardMaterial;
}

const PERFORMANCE_STORAGE_KEY = 'hc.brain.performanceMode.v1';
const QUALITY_TICK_MS = 55;
const PERFORMANCE_TICK_MS = 160;
const QUALITY_DECAY_FACTOR = 0.8;
const PERFORMANCE_DECAY_FACTOR = 0.52;
// Radians per second for the continuous idle auto-rotation.
const AUTO_ROTATE_SPEED = 0.25;
// Idle surface tone — a deeper, more saturated anatomical tan so the brain
// reads with colour instead of washing out toward grey-white.
const NEUTRAL_BRAIN_COLOR = '#c2917a';

function readPerformancePreference() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PERFORMANCE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function cloneMaterial(source: THREE.Material | THREE.Material[]): THREE.MeshStandardMaterial {
  const material = Array.isArray(source) ? source[0] : source;
  if (material instanceof THREE.MeshStandardMaterial) {
    const cloned = material.clone();
    cloned.roughness = 0.72;
    cloned.metalness = 0.03;
    return cloned;
  }
  return new THREE.MeshStandardMaterial({
    color: '#d9c5b7',
    roughness: 0.72,
    metalness: 0.03,
  });
}

function useBrainMeshParts(): BrainMeshPart[] {
  const gltf = useGLTF(BRAIN_MODEL.path);

  return useMemo(() => {
    const rawParts: BrainMeshPart[] = [];
    const bounds = new THREE.Box3();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const part = PARTS_BY_NODE.get(object.name);
      if (!part) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      if (geometry.boundingBox) bounds.union(geometry.boundingBox);
      rawParts.push({
        part,
        geometry,
        baseMaterial: cloneMaterial(object.material),
      });
    });

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const scale = 3.1 / (Math.max(size.x, size.y, size.z) || 1);

    return rawParts.map((meshPart) => {
      meshPart.geometry.translate(-center.x, -center.y, -center.z);
      meshPart.geometry.scale(scale, scale, scale);
      meshPart.geometry.computeBoundingBox();
      return meshPart;
    });
  }, [gltf.scene]);
}

function LoadingModel() {
  return (
    <Html center>
      <div className="brain-loader">Loading brain model</div>
    </Html>
  );
}

function BrainMesh({
  meshPart,
  selectedRegion,
  hoveredRegion,
  onHover,
  onSelect,
  performanceMode,
}: {
  meshPart: BrainMeshPart;
  selectedRegion: RegionId | null;
  hoveredRegion: RegionId | null;
  onHover: (region: RegionId | null) => void;
  onSelect: (region: RegionId) => void;
  performanceMode: boolean;
}) {
  const material = useMemo(() => meshPart.baseMaterial.clone(), [meshPart.baseMaterial]);
  const neutralColor = useMemo(() => new THREE.Color(NEUTRAL_BRAIN_COLOR), []);
  const regionState = useBrainStore((store) => store.regions);
  const ref = useRef<THREE.Mesh>(null);
  const selected = selectedRegion ? meshPart.part.regionIds.includes(selectedRegion) : false;
  const hovered = hoveredRegion ? meshPart.part.regionIds.includes(hoveredRegion) : false;

  // A mesh part can map to more than one region. Glow in the colour of
  // whichever region is most active right now, so the lit colour tracks the
  // agent that is actually working instead of a fixed primary-region colour.
  let activeRegion = primaryRegionForPart(meshPart.part);
  let glow = 0;
  for (const regionId of meshPart.part.regionIds) {
    const state = regionState[regionId];
    const lit = Math.max(state.base, state.accent);
    if (lit > glow) {
      glow = lit;
      activeRegion = regionId;
    }
  }
  const intensity = Math.max(glow, selected ? 0.95 : 0, hovered ? 0.75 : 0);
  const regionColor = useMemo(() => new THREE.Color(regionById(activeRegion).emissive), [activeRegion]);

  useEffect(() => {
    material.emissive.copy(regionColor);
    // Vivid lit regions: strong emissive and a near-full colour blend so an
    // active region reads clearly as its agent colour, not a washed tan.
    material.emissiveIntensity = intensity > 0.03 ? 0.35 + intensity * 1.5 : 0.05;
    material.color.lerpColors(neutralColor, regionColor, Math.min(0.95, intensity * 1.05));
    material.needsUpdate = true;
  }, [intensity, material, neutralColor, regionColor]);

  const primaryRegion = primaryRegionForPart(meshPart.part);

  const mesh = (
    <mesh
      ref={ref}
      geometry={meshPart.geometry}
      material={material}
      castShadow={!performanceMode}
      receiveShadow={!performanceMode}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onHover(primaryRegion);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onHover(null);
        document.body.style.cursor = '';
      }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect(primaryRegion);
      }}
    />
  );

  if (performanceMode) return mesh;
  return <Select enabled={selected || hovered || intensity > 0.12}>{mesh}</Select>;
}

interface BrainModelProps extends BrainCanvasProps {
  rotateEnabled: boolean;
  performanceMode: boolean;
}

function BrainModel({ rotateEnabled, performanceMode, ...props }: BrainModelProps) {
  const tick = useBrainStore((store) => store.tick);
  const hasActiveGlow = useBrainStore((store) =>
    Object.values(store.regions).some((region) => region.base > 0.01 || region.accent > 0.01),
  );
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef<THREE.Group>(null);
  const lastTickRef = useRef(0);
  const parts = useBrainMeshParts();

  useEffect(() => {
    if (!performanceMode || !hasActiveGlow) return;
    const interval = window.setInterval(() => {
      tick(PERFORMANCE_DECAY_FACTOR);
      invalidate();
    }, PERFORMANCE_TICK_MS);
    return () => window.clearInterval(interval);
  }, [hasActiveGlow, invalidate, performanceMode, tick]);

  // Continuous slow auto-rotation, paused only while the user is dragging
  // the model with the mouse (rotateEnabled flips off on OrbitControls drag).
  useFrame((state, delta) => {
    if (!performanceMode) {
      const elapsedMs = state.clock.elapsedTime * 1000;
      if (elapsedMs - lastTickRef.current >= QUALITY_TICK_MS) {
        tick(QUALITY_DECAY_FACTOR);
        lastTickRef.current = elapsedMs;
      }
    }
    if (!groupRef.current) return;
    groupRef.current.rotation.x = 0.12;
    if (!performanceMode && rotateEnabled) {
      groupRef.current.rotation.y += delta * AUTO_ROTATE_SPEED;
    }
  });

  return (
    <group ref={groupRef} position={[0, -0.04, 0]}>
      {parts.map((meshPart) => (
        <BrainMesh
          key={meshPart.part.nodeName}
          meshPart={meshPart}
          selectedRegion={props.selectedRegion}
          hoveredRegion={props.hoveredRegion}
          onHover={props.onHoverRegion}
          onSelect={props.onSelectRegion}
          performanceMode={performanceMode}
        />
      ))}
    </group>
  );
}

interface SceneProps extends BrainCanvasProps {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
  performanceMode: boolean;
}

function CameraCapture({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera, cameraRef]);
  return null;
}

function BrainScene({ cameraRef, controlsRef, performanceMode, ...props }: SceneProps) {
  const [rotateEnabled, setRotateEnabled] = useState(true);
  const scene = (
    <>
      <CameraCapture cameraRef={cameraRef} />
      <BrainModel {...props} rotateEnabled={rotateEnabled} performanceMode={performanceMode} />
      {!performanceMode && (
        <EffectComposer multisampling={4} autoClear={false}>
          <Outline blur edgeStrength={3.4} pulseSpeed={0.25} visibleEdgeColor={0x3dd1bf} hiddenEdgeColor={0x1d2533} />
          <Bloom intensity={0.34} luminanceThreshold={0.5} luminanceSmoothing={0.48} mipmapBlur />
          <Vignette eskil={false} offset={0.18} darkness={0.7} />
        </EffectComposer>
      )}
      <OrbitControls
        ref={controlsRef as React.MutableRefObject<OrbitControlsImpl>}
        enablePan
        enableZoom
        enableDamping={!performanceMode}
        dampingFactor={performanceMode ? 0.08 : 0.12}
        rotateSpeed={0.55}
        zoomSpeed={0.85}
        panSpeed={0.6}
        minDistance={2.2}
        maxDistance={16}
        screenSpacePanning
        onStart={() => setRotateEnabled(false)}
        onEnd={() => setRotateEnabled(true)}
      />
    </>
  );
  if (performanceMode) return scene;
  return <Selection>{scene}</Selection>;
}

function useModelPresence() {
  const [state, setState] = useState<{ ready: boolean; missing: boolean; error: string | null }>({
    ready: false,
    missing: false,
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(BRAIN_MODEL.path, { method: 'HEAD' });
        if (cancelled) return;
        setState({ ready: res.ok, missing: !res.ok, error: res.ok ? null : `HTTP ${res.status}` });
      } catch (err) {
        if (cancelled) return;
        setState({ ready: false, missing: true, error: err instanceof Error ? err.message : 'fetch failed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

const INITIAL_CAMERA: [number, number, number] = [0, 0.18, 5.6];

export function BrainCanvas(props: BrainCanvasProps) {
  const presence = useModelPresence();
  const [performanceMode, setPerformanceMode] = useState(readPerformancePreference);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasDpr = useMemo<[number, number]>(() => (performanceMode ? [0.75, 1] : [1, 2]), [performanceMode]);
  const glOptions = useMemo(
    () => ({
      antialias: !performanceMode,
      powerPreference: performanceMode ? 'low-power' as const : 'high-performance' as const,
    }),
    [performanceMode],
  );

  const resetView = () => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!controls || !camera) return;
    camera.position.set(...INITIAL_CAMERA);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '0') {
        event.preventDefault();
        resetView();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PERFORMANCE_STORAGE_KEY, performanceMode ? 'true' : 'false');
    } catch {
      // Local storage can be unavailable in restricted webviews; the toggle still works in memory.
    }
  }, [performanceMode]);

  if (presence.missing) {
    return (
      <div className="brain-empty" role="status">
        <p className="brain-empty-title">Brain model not bundled</p>
        <p className="brain-empty-detail">
          Expected <code>{BRAIN_MODEL.path}</code>
          {presence.error ? ` (${presence.error}).` : '.'} Drop a licensed GLB at that path or run{' '}
          <code>npm run validate:brain-model</code> to confirm node names.
        </p>
      </div>
    );
  }

  if (!presence.ready) {
    return (
      <div className="brain-empty" role="status">
        <p className="brain-empty-title">Checking brain model</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="brain-canvas-host" data-performance={performanceMode ? 'true' : 'false'}>
      <Canvas
        camera={{ position: INITIAL_CAMERA, fov: 32 }}
        dpr={canvasDpr}
        frameloop={performanceMode ? 'demand' : 'always'}
        gl={glOptions}
        shadows={!performanceMode}
        onPointerMissed={() => props.onSelectRegion(null)}
      >
        <color attach="background" args={['#04070d']} />
        <fog attach="fog" args={['#04070d', 6.4, 12]} />
        <ambientLight intensity={0.42} />
        <hemisphereLight args={['#d8fff6', '#0d1722', 0.58]} />
        <directionalLight position={[2.8, 4.2, 3.5]} intensity={performanceMode ? 1.4 : 1.95} color="#f3eee2" castShadow={!performanceMode} />
        <directionalLight position={[-3.4, 0.6, -2.4]} intensity={performanceMode ? 0.5 : 0.78} color="#5fdcd0" />
        <Suspense fallback={<LoadingModel />}>
          <BrainScene cameraRef={cameraRef} controlsRef={controlsRef} performanceMode={performanceMode} {...props} />
        </Suspense>
      </Canvas>
      <BrainOverlay
        cameraRef={cameraRef}
        containerRef={containerRef}
        hoveredRegion={props.hoveredRegion}
        selectedRegion={props.selectedRegion}
      />
      <div className="brain-canvas-tools">
        <button
          type="button"
          className="brain-performance"
          aria-pressed={performanceMode}
          onClick={() => setPerformanceMode((current) => !current)}
          title={performanceMode ? 'Quality mode' : 'Performance mode'}
          aria-label={performanceMode ? 'Use quality brain rendering' : 'Use performance brain rendering'}
        >
          <Icon name="gauge" size={13} />
        </button>
        <button
          type="button"
          className="brain-reset"
          onClick={resetView}
          title="Reset view (⌘0)"
          aria-label="Reset view"
        >
          <Icon name="eye" size={13} />
        </button>
      </div>
    </div>
  );
}

useGLTF.preload(BRAIN_MODEL.path);
