// Real 3D vector map of project memory. Every node is positioned by the PCA
// projection of its ACTUAL stored embedding (see pca3.ts) and coloured by the
// k-means cluster that embedding falls into (see cluster.ts) — so the screen
// shows genuine semantic groups, not arbitrary per-query colours. Clusters are
// gently pushed apart along their centroid direction so the groups read as
// distinct blobs, and edges are the real cosine nearest-neighbour links.
// Rendered with React Three Fiber (orbit / zoom / pan + idle auto-rotate).

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getChunkVectors, type RagChunk } from '@core/rag';
import { Icon } from '@ui/icons';
import { pca3, type Vec3 } from './pca3';
import { chooseK, distinctiveClusterLabels, kmeans } from './cluster';

const MAX_NODES = 500; // cap for smooth interaction
const NEIGHBOURS_PER_NODE = 2;
const EDGE_MIN_SIMILARITY = 0.55;
const CLUSTER_SPREAD = 1.45; // how far clusters are pushed apart for legibility

interface VecNode {
  chunk: RagChunk;
  pos: Vec3;
  vector: Float32Array;
  cluster: number;
}

interface ClusterInfo {
  index: number;
  label: string;
  color: string;
  size: number;
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

// Evenly-spaced, high-separation hues so adjacent clusters never blur together.
function clusterColor(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(1, total));
  return `hsl(${hue} 82% 60%)`;
}

interface BuiltGraph {
  nodes: VecNode[];
  edges: Array<{ a: number; b: number; intra: boolean }>;
  intraPositions: Float32Array;
  interPositions: Float32Array;
  clusters: ClusterInfo[];
}

function buildGraph(chunks: RagChunk[]): BuiltGraph | null {
  // Newest first, capped — and only chunks that actually have an embedding.
  const ordered = [...chunks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_NODES);
  const vectors = getChunkVectors(ordered.map((c) => c.id));
  const withVec = ordered.filter((c) => vectors.has(c.id));
  if (withVec.length < 3) return null;

  const vecList = withVec.map((c) => vectors.get(c.id)!);
  const coords = pca3(vecList, 4);

  // Real k-means clustering on the embeddings → semantic groups.
  const { assignments, k } = kmeans(vecList, chooseK(withVec.length));

  // Project each cluster centroid through the same PCA basis (by averaging its
  // members' coordinates) and nudge members outward along that direction so the
  // groups separate visually without distorting within-cluster structure.
  const centroidCoord: Vec3[] = Array.from({ length: k }, () => [0, 0, 0]);
  const counts = new Array<number>(k).fill(0);
  assignments.forEach((c, i) => {
    const p = coords[i]!;
    centroidCoord[c]![0] += p[0];
    centroidCoord[c]![1] += p[1];
    centroidCoord[c]![2] += p[2];
    counts[c] = (counts[c] ?? 0) + 1;
  });
  for (let c = 0; c < k; c += 1) {
    const n = counts[c]! || 1;
    centroidCoord[c] = [centroidCoord[c]![0] / n, centroidCoord[c]![1] / n, centroidCoord[c]![2] / n];
  }

  const nodes: VecNode[] = withVec.map((chunk, i) => {
    const c = assignments[i]!;
    const base = coords[i]!;
    const cen = centroidCoord[c]!;
    const pos: Vec3 = [
      base[0] + cen[0] * (CLUSTER_SPREAD - 1),
      base[1] + cen[1] * (CLUSTER_SPREAD - 1),
      base[2] + cen[2] * (CLUSTER_SPREAD - 1),
    ];
    return { chunk, pos, vector: vectors.get(chunk.id)!, cluster: c };
  });

  // Cluster legend: name each group by its most frequent meaningful terms.
  const sizes = new Array<number>(k).fill(0);
  const labelTexts: string[][] = Array.from({ length: k }, () => []);
  nodes.forEach((node) => {
    sizes[node.cluster] = (sizes[node.cluster] ?? 0) + 1;
    labelTexts[node.cluster]!.push(node.chunk.query ?? node.chunk.title);
  });
  // Distinctive per-cluster labels so two groups on the same broad topic don't
  // both read "Digoxin · Nsaids".
  const labels = distinctiveClusterLabels(labelTexts);
  const clusters: ClusterInfo[] = Array.from({ length: k }, (_, i) => ({
    index: i,
    label: labels[i] ?? `Group ${i + 1}`,
    color: clusterColor(i, k),
    size: sizes[i]!,
  })).sort((a, b) => b.size - a.size);

  // Nearest-neighbour edges from real cosine similarity, split into intra- and
  // inter-cluster so the renderer can mute the cross-group links.
  const edgeKeys = new Set<string>();
  const edges: Array<{ a: number; b: number; intra: boolean }> = [];
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
      edges.push({ a: i, b: j, intra: nodes[i]!.cluster === nodes[j]!.cluster });
    }
  }

  const intra = edges.filter((e) => e.intra);
  const inter = edges.filter((e) => !e.intra);
  const fill = (list: typeof edges): Float32Array => {
    const out = new Float32Array(list.length * 6);
    list.forEach((e, idx) => {
      out.set(nodes[e.a]!.pos, idx * 6);
      out.set(nodes[e.b]!.pos, idx * 6 + 3);
    });
    return out;
  };

  return { nodes, edges, intraPositions: fill(intra), interPositions: fill(inter), clusters };
}

function Edges({ positions, color, opacity }: { positions: Float32Array; color: string; opacity: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  if (positions.length === 0) return null;
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={opacity} />
    </lineSegments>
  );
}

// Faint origin gizmo so the three principal axes are legible — this is the
// "3-axis" frame the vectors are projected onto.
function AxisFrame() {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const L = 5.2;
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        // prettier-ignore
        new Float32Array([
          -L, 0, 0, L, 0, 0,
          0, -L, 0, 0, L, 0,
          0, 0, -L, 0, 0, L,
        ]),
        3,
      ),
    );
    return g;
  }, []);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#243049" transparent opacity={0.5} />
    </lineSegments>
  );
}

// Idle auto-rotation that conveys depth, paused whenever the user is dragging.
function SceneSpin({ active }: { active: boolean }) {
  const { scene } = useThree();
  useFrame((_, delta) => {
    if (active) scene.rotation.y += delta * 0.08;
  });
  return null;
}

function Node({
  node,
  color,
  dimmed,
  selected,
  onSelect,
}: {
  node: VecNode;
  color: string;
  dimmed: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const r = node.chunk.kind === 'answer' ? 0.09 : 0.062;
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
        scale={selected ? 1.9 : hovered ? 1.5 : 1}
      >
        <sphereGeometry args={[r, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 1 : hovered ? 0.8 : 0.6}
          roughness={0.35}
          transparent
          opacity={dimmed ? 0.18 : 1}
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
  const [focusCluster, setFocusCluster] = useState<number | null>(null);
  const [spin, setSpin] = useState(true);
  const dragging = useRef(false);

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
  const colorByCluster = (c: number) => graph.clusters.find((cl) => cl.index === c)?.color ?? '#8b9eff';
  const isDimmed = (c: number) => focusCluster !== null && c !== focusCluster;

  return (
    <div className="memory-vec3d">
      <Canvas
        camera={{ position: [5.5, 3.5, 8.5], fov: 45 }}
        dpr={[1, 2]}
        onPointerMissed={() => {
          setSelectedId(null);
          setFocusCluster(null);
        }}
      >
        <color attach="background" args={['#05080f']} />
        <fog attach="fog" args={['#05080f', 9, 19]} />
        <ambientLight intensity={0.7} />
        <pointLight position={[6, 8, 10]} intensity={1.1} />
        <SceneSpin active={spin && focusCluster === null && !selected} />
        <AxisFrame />
        <Edges positions={graph.intraPositions} color="#6b7aa0" opacity={focusCluster === null ? 0.3 : 0.12} />
        <Edges positions={graph.interPositions} color="#3a465e" opacity={0.12} />
        {graph.nodes.map((node) => (
          <Node
            key={node.chunk.id}
            node={node}
            color={colorByCluster(node.cluster)}
            dimmed={isDimmed(node.cluster)}
            selected={node.chunk.id === selectedId}
            onSelect={setSelectedId}
          />
        ))}
        <OrbitControls
          enablePan
          enableZoom
          enableDamping
          dampingFactor={0.12}
          rotateSpeed={0.6}
          onStart={() => {
            dragging.current = true;
            setSpin(false);
          }}
          onEnd={() => {
            dragging.current = false;
          }}
        />
      </Canvas>

      <div className="memory-vec3d-clusters">
        {graph.clusters.map((cl) => (
          <button
            key={cl.index}
            type="button"
            className="memory-vec3d-cluster"
            data-active={focusCluster === cl.index}
            data-muted={focusCluster !== null && focusCluster !== cl.index}
            onClick={() => setFocusCluster((cur) => (cur === cl.index ? null : cl.index))}
            title={`${cl.label} — ${cl.size} findings`}
          >
            <span className="memory-vec3d-swatch" style={{ background: cl.color }} />
            {cl.label}
            <span className="memory-vec3d-cluster-count">{cl.size}</span>
          </button>
        ))}
      </div>

      <div className="memory-vec3d-legend">
        {graph.nodes.length} findings · {graph.clusters.length} clusters · {graph.edges.length} semantic links ·
        3-axis PCA of real embeddings
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
