// Real 3D vector map of project memory. Every node is positioned by the PCA
// projection of its ACTUAL stored embedding (see pca3.ts), and every edge is a
// genuine nearest-neighbour link computed from cosine similarity of those
// vectors — so the structure reflects real semantic relationships, not a
// decorative layout. Rendered with React Three Fiber (orbit / zoom / pan).

import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { getChunkVectors, type RagChunk } from '@core/rag';
import { Icon } from '@ui/icons';
import { pca3, type Vec3 } from './pca3';

const MAX_NODES = 500; // cap for smooth interaction
const NEIGHBOURS_PER_NODE = 2;
const EDGE_MIN_SIMILARITY = 0.55;

interface VecNode {
  chunk: RagChunk;
  pos: Vec3;
  vector: Float32Array;
  colorIndex: number;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    d += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

function topicColor(index: number): string {
  return `hsl(${(index * 67) % 360} 72% 62%)`;
}

interface BuiltGraph {
  nodes: VecNode[];
  edges: Array<[number, number]>;
  positions: Float32Array; // flat xyz pairs for lineSegments
}

function buildGraph(chunks: RagChunk[]): BuiltGraph | null {
  // Newest first, capped — and only chunks that actually have an embedding.
  const ordered = [...chunks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_NODES);
  const vectors = getChunkVectors(ordered.map((c) => c.id));
  const withVec = ordered.filter((c) => vectors.has(c.id));
  if (withVec.length < 3) return null;

  const coords = pca3(
    withVec.map((c) => vectors.get(c.id)!),
    4,
  );
  // Colour by topic (the saved subject label / query), stable per topic.
  const topicIndex = new Map<string, number>();
  const nodes: VecNode[] = withVec.map((chunk, i) => {
    const topic = chunk.query ?? chunk.title;
    if (!topicIndex.has(topic)) topicIndex.set(topic, topicIndex.size);
    return { chunk, pos: coords[i]!, vector: vectors.get(chunk.id)!, colorIndex: topicIndex.get(topic)! };
  });

  // Nearest-neighbour edges from real cosine similarity.
  const edgeKeys = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const sims: Array<{ j: number; s: number }> = [];
    for (let j = 0; j < nodes.length; j += 1) {
      if (i === j) continue;
      sims.push({ j, s: cosine(nodes[i]!.vector, nodes[j]!.vector) });
    }
    sims.sort((a, b) => b.s - a.s);
    for (const { j, s } of sims.slice(0, NEIGHBOURS_PER_NODE)) {
      if (s < EDGE_MIN_SIMILARITY) break;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push([i, j]);
    }
  }

  const positions = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], e) => {
    positions.set(nodes[a]!.pos, e * 6);
    positions.set(nodes[b]!.pos, e * 6 + 3);
  });

  return { nodes, edges, positions };
}

function Edges({ positions }: { positions: Float32Array }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#5f6b86" transparent opacity={0.28} />
    </lineSegments>
  );
}

function Node({
  node,
  selected,
  onSelect,
}: {
  node: VecNode;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = node.chunk.kind === 'answer' ? '#8b9eff' : topicColor(node.colorIndex);
  const r = node.chunk.kind === 'answer' ? 0.085 : 0.06;
  return (
    <group position={node.pos}>
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.chunk.id);
        }}
        scale={selected ? 1.8 : hovered ? 1.5 : 1}
      >
        <sphereGeometry args={[r, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.9 : hovered ? 0.6 : 0.25}
          roughness={0.4}
        />
      </mesh>
      {(hovered || selected) && (
        <Html center distanceFactor={8} className="memory-vec3d-label-wrap" zIndexRange={[20, 0]}>
          <span className="memory-vec3d-label">{node.chunk.title.slice(0, 60)}</span>
        </Html>
      )}
    </group>
  );
}

export function MemoryVectorGraph3D({
  chunks,
  onRemove,
}: {
  chunks: RagChunk[];
  onRemove: (id: string) => void;
}) {
  const graph = useMemo(() => buildGraph(chunks), [chunks]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!graph) {
    return (
      <div className="memory-vec3d memory-vec3d-empty">
        <Icon name="graph" size={20} />
        <p>The 3D vector map needs at least 3 embedded findings.</p>
        <p className="memory-vec3d-hint">
          Embeddings build in the background after research runs. Once findings are indexed, they appear
          here positioned by real semantic similarity.
        </p>
      </div>
    );
  }

  const selected = selectedId ? graph.nodes.find((n) => n.chunk.id === selectedId) : null;
  const neighbours = selected
    ? graph.nodes
        .filter((n) => n.chunk.id !== selected.chunk.id)
        .map((n) => ({ node: n, sim: cosine(selected.vector, n.vector) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 3)
    : [];

  return (
    <div className="memory-vec3d">
      <Canvas camera={{ position: [0, 0, 9], fov: 45 }} dpr={[1, 2]} onPointerMissed={() => setSelectedId(null)}>
        <color attach="background" args={['#05080f']} />
        <ambientLight intensity={0.7} />
        <pointLight position={[6, 8, 10]} intensity={1.1} />
        <Edges positions={graph.positions} />
        {graph.nodes.map((node) => (
          <Node key={node.chunk.id} node={node} selected={node.chunk.id === selectedId} onSelect={setSelectedId} />
        ))}
        <OrbitControls enablePan enableZoom enableDamping dampingFactor={0.12} rotateSpeed={0.6} />
      </Canvas>

      <div className="memory-vec3d-legend">
        {graph.nodes.length} findings · {graph.edges.length} semantic links · PCA of real embeddings
      </div>

      {selected && (
        <div className="memory-graph-detail">
          <header>
            <span className="memory-kind" data-kind={selected.chunk.kind}>
              {selected.chunk.kind}
            </span>
            <button
              type="button"
              className="memory-graph-detail-close"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
            >
              <Icon name="close" size={13} />
            </button>
          </header>
          <h4>{selected.chunk.title}</h4>
          {selected.chunk.query && <p className="memory-graph-detail-topic">{selected.chunk.query}</p>}
          <p className="memory-graph-detail-text">{selected.chunk.text.slice(0, 220)}</p>
          {neighbours.length > 0 && (
            <ul className="memory-graph-detail-list">
              {neighbours.map(({ node, sim }) => (
                <li key={node.chunk.id}>
                  <span>nearest · {(sim * 100).toFixed(0)}% match</span>
                  {node.chunk.title.slice(0, 64)}
                </li>
              ))}
            </ul>
          )}
          <footer>
            {selected.chunk.url ? (
              <a href={selected.chunk.url} target="_blank" rel="noreferrer">
                <Icon name="quote" size={11} /> Source
              </a>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="memory-graph-detail-remove"
              onClick={() => {
                onRemove(selected.chunk.id);
                setSelectedId(null);
              }}
            >
              <Icon name="close" size={11} /> Remove
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}
