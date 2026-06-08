// Real 3D vector map of project memory. Every node is positioned by the PCA
// projection of its ACTUAL stored embedding (see pca3.ts) and coloured by the
// k-means cluster that embedding falls into (see cluster.ts) — so the screen
// shows genuine semantic groups, not arbitrary per-query colours. Clusters are
// gently pushed apart along their centroid direction so the groups read as
// distinct blobs, and edges are the real cosine nearest-neighbour links.
// Rendered with React Three Fiber (orbit / zoom / pan + idle auto-rotate).

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useWindowActive } from '@ui/hooks/useWindowActive';
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

// A curated, high-separation palette so each cluster reads as a distinct colour
// even with only two or three groups. Beyond the palette we fall back to evenly
// spaced hues so any number of clusters stays legible.
const CLUSTER_PALETTE = [
  '#ff6b6b', // red
  '#4dd2ff', // cyan
  '#ffd93d', // amber
  '#6bff95', // green
  '#c08bff', // violet
  '#ff9f4d', // orange
  '#5b9dff', // blue
  '#ff7bd5', // pink
  '#7ce0c0', // teal
  '#d4ff5b', // lime
];

function clusterColor(index: number, total: number): string {
  if (index < CLUSTER_PALETTE.length) return CLUSTER_PALETTE[index]!;
  const hue = Math.round((index * 360) / Math.max(1, total));
  return `hsl(${hue} 85% 64%)`;
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

  // Recentre the whole cloud on the origin so it sits on the axis crosshair and
  // the orbit target frames it — otherwise the cluster-spread nudge can drift
  // the centroid off-centre, making the view feel lopsided and "too close".
  const mean: Vec3 = [0, 0, 0];
  for (const n of nodes) {
    mean[0] += n.pos[0];
    mean[1] += n.pos[1];
    mean[2] += n.pos[2];
  }
  mean[0] /= nodes.length;
  mean[1] /= nodes.length;
  mean[2] /= nodes.length;
  for (const n of nodes) {
    n.pos = [n.pos[0] - mean[0], n.pos[1] - mean[1], n.pos[2] - mean[2]];
  }

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
      {/* toneMapped=false keeps the link colour at full strength instead of
          being darkened by the renderer's tone mapping. */}
      <lineBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
    </lineSegments>
  );
}

// The real 3-axis reference frame the embeddings are projected onto: three
// coloured, labelled principal-component axes (PC1/PC2/PC3) plus a faint floor
// grid for depth. Rendered inside the rotating scene so the frame turns with
// the data and the axes always describe the points' true orientation.
const AXIS_LEN = 5;
const AXES = [
  { dir: [1, 0, 0] as const, color: '#e0607a', label: 'PC1' },
  { dir: [0, 1, 0] as const, color: '#5fd0b0', label: 'PC2' },
  { dir: [0, 0, 1] as const, color: '#7c8cff', label: 'PC3' },
] as const;

function AxisLine({ dir, color }: { dir: readonly [number, number, number]; color: string }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // A short negative stub through the origin + the full positive axis.
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          -dir[0] * AXIS_LEN * 0.35, -dir[1] * AXIS_LEN * 0.35, -dir[2] * AXIS_LEN * 0.35,
          dir[0] * AXIS_LEN, dir[1] * AXIS_LEN, dir[2] * AXIS_LEN,
        ]),
        3,
      ),
    );
    return g;
  }, [dir]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.8} toneMapped={false} />
    </lineSegments>
  );
}

// A light wireframe "ground" plane below the cloud — gives the scene a floor to
// read depth against. Drawn in a cool white at low opacity so it reads as a
// grid without washing out the data above it.
function FloorGrid() {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const half = AXIS_LEN;
    const y = -AXIS_LEN;
    const pts: number[] = [];
    for (let i = -half; i <= half; i += 1) {
      pts.push(-half, y, i, half, y, i);
      pts.push(i, y, -half, i, y, half);
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#cdd8f0" transparent opacity={0.16} toneMapped={false} />
    </lineSegments>
  );
}

function Axes3D() {
  return (
    <group>
      <FloorGrid />
      {AXES.map((axis) => (
        <group key={axis.label}>
          <AxisLine dir={axis.dir} color={axis.color} />
          <Html
            position={[axis.dir[0] * AXIS_LEN, axis.dir[1] * AXIS_LEN, axis.dir[2] * AXIS_LEN]}
            center
            className="memory-vec3d-axis-wrap"
            zIndexRange={[10, 0]}
          >
            <span className="memory-vec3d-axis" style={{ color: axis.color }}>
              {axis.label}
            </span>
          </Html>
        </group>
      ))}
    </group>
  );
}

// Gentle auto-rotation that conveys depth. Driven on-demand (the canvas is in
// 'demand' frameloop) only while active AND the window is focused; when the user
// stops it (perf toggle), focuses a node/cluster, leaves the mode, or
// backgrounds the app, no frames render and the graph costs no GPU.
function SceneSpin({ active }: { active: boolean }) {
  const { scene, invalidate } = useThree();
  const focused = useWindowActive();
  useFrame((_, delta) => {
    if (active && focused) scene.rotation.y += Math.min(delta, 1 / 30) * 0.08;
  });
  useEffect(() => {
    if (!active || !focused) return;
    let raf = 0;
    const loop = () => {
      invalidate();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, focused, invalidate]);
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
  // Answers and imported library papers render a touch larger than evidence
  // passages so they stand out as the anchor points of a topic.
  const r = node.chunk.kind === 'evidence' ? 0.12 : 0.16;
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
        <sphereGeometry args={[r, 20, 20]} />
        {/* toneMapped=false + a strong emissive keeps every node vivid against
            the dark scene so the clusters and their colours read clearly. */}
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 1.5 : hovered ? 1.3 : 1.05}
          roughness={0.3}
          toneMapped={false}
          transparent
          opacity={dimmed ? 0.2 : 1}
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
  onDeleteAll,
  deleteAllCount = 0,
}: {
  chunks: RagChunk[];
  onRemove: (id: string) => void;
  onDeleteAll?: () => void;
  deleteAllCount?: number;
}) {
  const graph = useMemo(() => buildGraph(chunks), [chunks]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusCluster, setFocusCluster] = useState<number | null>(null);
  const dragging = useRef(false);
  // The graph auto-rotates by default while it is on screen; a perf toggle stops
  // it. When the Memory mode is hidden (another mode active → display:none) the
  // canvas is off-screen, so rendering stops entirely.
  const [spin, setSpin] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

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
    <div className="memory-vec3d" ref={containerRef}>
      <Canvas
        camera={{ position: [8, 4.8, 12.5], fov: 45, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        frameloop={visible ? 'demand' : 'never'}
        onPointerMissed={() => {
          setSelectedId(null);
          setFocusCluster(null);
        }}
      >
        <color attach="background" args={['#070c16']} />
        {/* Fog gives depth, but its far plane MUST sit beyond the farthest the
            user can dolly out (OrbitControls maxDistance below) — otherwise
            zooming out pushes the cloud past the fog and it vanishes. */}
        <fog attach="fog" args={['#070c16', 30, 90]} />
        <ambientLight intensity={0.95} />
        <pointLight position={[6, 8, 10]} intensity={1.2} />
        <SceneSpin active={spin && visible && focusCluster === null && !selected} />
        <Axes3D />
        <Edges positions={graph.intraPositions} color="#b9c6ee" opacity={focusCluster === null ? 0.5 : 0.18} />
        <Edges positions={graph.interPositions} color="#7180a6" opacity={0.22} />
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
          makeDefault
          enablePan
          enableZoom
          enableDamping
          dampingFactor={0.12}
          rotateSpeed={0.6}
          zoomSpeed={0.8}
          // Look at a point right-and-below the origin so the cloud (centred on
          // the origin) sits a little left and up of screen centre — away from
          // the top-right cluster legend and into the empty left space. The
          // idle spin rotates the scene around the origin Y-axis, so the cloud
          // still turns in place at this offset.
          target={[2, -0.5, 0]}
          // Clamp the dolly range so the user can neither jam into the cloud nor
          // zoom out past the fog into an empty void; both ends stay framed.
          minDistance={5}
          maxDistance={48}
          onStart={() => {
            dragging.current = true;
          }}
          onEnd={() => {
            dragging.current = false;
          }}
        />
      </Canvas>

      <div className="memory-vec3d-tools">
        <button
          type="button"
          className="memory-vec3d-perf"
          aria-pressed={!spin}
          onClick={() => setSpin((s) => !s)}
          title={spin ? 'Stop auto-rotation (performance)' : 'Resume auto-rotation'}
          aria-label={spin ? 'Stop auto-rotation' : 'Resume auto-rotation'}
        >
          <Icon name="gauge" size={13} />
        </button>
      </div>

      {onDeleteAll && deleteAllCount > 0 && (
        <button
          type="button"
          className="memory-vec3d-deleteall"
          onClick={onDeleteAll}
          title="Delete all saved memory in this project"
        >
          <Icon name="close" size={12} /> Delete all
        </button>
      )}

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
            <span className="memory-vec3d-cluster-label">{cl.label}</span>
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
