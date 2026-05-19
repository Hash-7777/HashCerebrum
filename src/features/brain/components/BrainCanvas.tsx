import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Bloom, EffectComposer, Outline, Selection, Select, Vignette } from '@react-three/postprocessing';
import { Html, OrbitControls, useGLTF } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { RegionId } from '@config/agents';
import { useBrainStore } from '@core/store/brainStore';
import { Icon } from '@ui/icons';
import { BRAIN_MODEL, PARTS_BY_NODE, partColor, primaryRegionForPart, type BrainModelPart } from '../data/modelParts';
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
}: {
  meshPart: BrainMeshPart;
  selectedRegion: RegionId | null;
  hoveredRegion: RegionId | null;
  onHover: (region: RegionId | null) => void;
  onSelect: (region: RegionId) => void;
}) {
  const material = useMemo(() => meshPart.baseMaterial.clone(), [meshPart.baseMaterial]);
  const regionState = useBrainStore((store) => store.regions);
  const ref = useRef<THREE.Mesh>(null);
  const selected = selectedRegion ? meshPart.part.regionIds.includes(selectedRegion) : false;
  const hovered = hoveredRegion ? meshPart.part.regionIds.includes(hoveredRegion) : false;
  const intensity = Math.max(
    ...meshPart.part.regionIds.map((regionId) => {
      const state = regionState[regionId];
      return Math.max(state.base, state.accent);
    }),
    selected ? 0.92 : 0,
    hovered ? 0.72 : 0,
  );

  useFrame(() => {
    const color = new THREE.Color(partColor(meshPart.part));
    material.emissive.copy(color);
    material.emissiveIntensity = intensity > 0.03 ? 0.16 + intensity * 0.78 : 0.035;
    material.color.lerpColors(new THREE.Color('#cdb7a7'), color, Math.min(0.28, intensity * 0.26));
    material.needsUpdate = true;
  });

  const primaryRegion = primaryRegionForPart(meshPart.part);

  return (
    <Select enabled={selected || hovered || intensity > 0.12}>
      <mesh
        ref={ref}
        geometry={meshPart.geometry}
        material={material}
        castShadow
        receiveShadow
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
    </Select>
  );
}

interface BrainModelProps extends BrainCanvasProps {
  rotateEnabled: boolean;
}

function BrainModel({ rotateEnabled, ...props }: BrainModelProps) {
  const tick = useBrainStore((store) => store.tick);
  const groupRef = useRef<THREE.Group>(null);
  const parts = useBrainMeshParts();

  // Slow ambient drift, paused while the user is interacting with the
  // OrbitControls (otherwise the wobble fights the drag).
  useFrame((state) => {
    tick();
    if (!groupRef.current) return;
    if (rotateEnabled) {
      groupRef.current.rotation.y = -0.34 + Math.sin(state.clock.elapsedTime * 0.14) * 0.035;
      groupRef.current.rotation.x = 0.12 + Math.sin(state.clock.elapsedTime * 0.1) * 0.012;
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
        />
      ))}
    </group>
  );
}

interface SceneProps extends BrainCanvasProps {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  controlsRef: React.MutableRefObject<OrbitControlsImpl | null>;
}

function CameraCapture({ cameraRef }: { cameraRef: React.MutableRefObject<THREE.Camera | null> }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera, cameraRef]);
  return null;
}

function BrainScene({ cameraRef, controlsRef, ...props }: SceneProps) {
  const [rotateEnabled, setRotateEnabled] = useState(true);
  return (
    <Selection>
      <CameraCapture cameraRef={cameraRef} />
      <BrainModel {...props} rotateEnabled={rotateEnabled} />
      <EffectComposer multisampling={4} autoClear={false}>
        <Outline blur edgeStrength={3.4} pulseSpeed={0.25} visibleEdgeColor={0x3dd1bf} hiddenEdgeColor={0x1d2533} />
        <Bloom intensity={0.42} luminanceThreshold={0.28} luminanceSmoothing={0.48} mipmapBlur />
        <Vignette eskil={false} offset={0.18} darkness={0.7} />
      </EffectComposer>
      <OrbitControls
        ref={controlsRef as React.MutableRefObject<OrbitControlsImpl>}
        enablePan
        enableZoom
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={0.55}
        zoomSpeed={0.85}
        panSpeed={0.6}
        minDistance={2.2}
        maxDistance={16}
        screenSpacePanning
        onStart={() => setRotateEnabled(false)}
        onEnd={() => setRotateEnabled(true)}
      />
    </Selection>
  );
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
  const cameraRef = useRef<THREE.Camera | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div ref={containerRef} className="brain-canvas-host">
      <Canvas
        camera={{ position: INITIAL_CAMERA, fov: 32 }}
        dpr={[1, 2]}
        shadows
        onPointerMissed={() => props.onSelectRegion(null)}
      >
        <color attach="background" args={['#04070d']} />
        <fog attach="fog" args={['#04070d', 6.4, 12]} />
        <ambientLight intensity={0.5} />
        <hemisphereLight args={['#d8fff6', '#0d1722', 0.72]} />
        <directionalLight position={[2.8, 4.2, 3.5]} intensity={2.25} color="#f3eee2" castShadow />
        <directionalLight position={[-3.4, 0.6, -2.4]} intensity={0.96} color="#5fdcd0" />
        <Suspense fallback={<LoadingModel />}>
          <BrainScene cameraRef={cameraRef} controlsRef={controlsRef} {...props} />
        </Suspense>
      </Canvas>
      <BrainOverlay
        cameraRef={cameraRef}
        containerRef={containerRef}
        hoveredRegion={props.hoveredRegion}
        selectedRegion={props.selectedRegion}
      />
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
  );
}

useGLTF.preload(BRAIN_MODEL.path);
