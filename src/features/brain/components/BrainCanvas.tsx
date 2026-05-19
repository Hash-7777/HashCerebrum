import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { Html, OrbitControls } from '@react-three/drei';
import { useRef, useState } from 'react';
import * as THREE from 'three';
import type { RegionId } from '@config/agents';
import { useBrainStore } from '@core/store/brainStore';
import { regionById } from '../data/regions';
import { useLitRegions, type LitRegion } from '../useLitRegions';

interface BrainCanvasProps {
  selectedRegion: RegionId | null;
  onSelectRegion: (region: RegionId | null) => void;
}

function AtlasScaffold() {
  const ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.15) * 0.04;
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.11) * 0.012;
  });

  return (
    <group ref={ref} position={[0, -0.04, 0]}>
      <mesh scale={[1.18, 0.76, 0.58]} rotation={[0.02, -0.28, 0.02]}>
        <sphereGeometry args={[1, 72, 36]} />
        <meshStandardMaterial
          color="#d9e5ec"
          emissive="#203438"
          emissiveIntensity={0.24}
          roughness={0.82}
          metalness={0.02}
          transparent
          opacity={0.18}
          wireframe
        />
      </mesh>
      <mesh scale={[1.22, 0.8, 0.6]} rotation={[0.02, -0.28, 0.02]}>
        <sphereGeometry args={[1, 72, 36]} />
        <meshBasicMaterial color="#5fb3a8" transparent opacity={0.045} />
      </mesh>
    </group>
  );
}

function RegionMarker({
  region,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  region: LitRegion;
  selected: boolean;
  hovered: boolean;
  onHover: (region: RegionId | null) => void;
  onSelect: (region: RegionId) => void;
}) {
  const active = Math.max(region.intensity, selected ? 0.9 : 0, hovered ? 0.72 : 0);
  const markerScale = 0.035 + active * 0.025;
  const color = new THREE.Color(region.emissive);

  const handleOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(region.id);
  };

  const handleOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover(null);
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(region.id);
  };

  return (
    <group position={region.anchor}>
      <mesh
        scale={markerScale}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial
          color={region.emissive}
          emissive={color}
          emissiveIntensity={1.1 + active * 1.8}
          roughness={0.42}
        />
      </mesh>
      {(active > 0.1 || selected || hovered) && (
        <mesh scale={markerScale * 2.6}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshBasicMaterial color={region.emissive} transparent opacity={0.13 + active * 0.16} />
        </mesh>
      )}
    </group>
  );
}

function RegionTooltip({ regionId }: { regionId: RegionId | null }) {
  if (!regionId) return null;
  const region = regionById(regionId);

  return (
    <Html position={region.anchor} center distanceFactor={7}>
      <div className="brain-tooltip">
        <strong>{region.label}</strong>
        <span>{region.description}</span>
      </div>
    </Html>
  );
}

function RegionAtlas({
  selectedRegion,
  onSelectRegion,
}: BrainCanvasProps) {
  const [hoveredRegion, setHoveredRegion] = useState<RegionId | null>(null);
  const regions = useLitRegions();
  const activeRegion = hoveredRegion ?? selectedRegion;

  return (
    <>
      {regions.map((region) => (
        <RegionMarker
          key={region.id}
          region={region}
          selected={selectedRegion === region.id}
          hovered={hoveredRegion === region.id}
          onHover={setHoveredRegion}
          onSelect={onSelectRegion}
        />
      ))}
      <RegionTooltip regionId={activeRegion} />
    </>
  );
}

function BrainScene(props: BrainCanvasProps) {
  const tick = useBrainStore((store) => store.tick);
  useFrame(() => tick());

  return (
    <>
      <AtlasScaffold />
      <RegionAtlas {...props} />
    </>
  );
}

export function BrainCanvas({ selectedRegion, onSelectRegion }: BrainCanvasProps) {
  return (
    <Canvas
      camera={{ position: [0, 0.16, 5.3], fov: 30 }}
      dpr={[1, 2]}
      shadows
      onPointerMissed={() => onSelectRegion(null)}
    >
      <color attach="background" args={['#06080c']} />
      <fog attach="fog" args={['#06080c', 5.2, 7.8]} />
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#d8fff6', '#16202a', 0.64]} />
      <directionalLight position={[2.8, 4.2, 3.5]} intensity={2.2} color="#f3eee2" castShadow />
      <directionalLight position={[-3.4, 0.6, -2.4]} intensity={0.9} color="#4cc9c2" />
      <BrainScene selectedRegion={selectedRegion} onSelectRegion={onSelectRegion} />
      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={3.7}
        maxDistance={7}
        rotateSpeed={0.42}
      />
      <EffectComposer>
        <Bloom intensity={0.42} luminanceThreshold={0.36} luminanceSmoothing={0.54} mipmapBlur />
        <Vignette eskil={false} offset={0.18} darkness={0.72} />
      </EffectComposer>
    </Canvas>
  );
}
