// Memory graph view — an Obsidian-style topic map of a project's saved RAG
// chunks. Nodes are findings, edges are topic links, and clusters are labelled
// research constellations so the map is interpretable before a node is opened.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { RagChunk } from '@core/store/ragStore';
import { useBrainStore } from '@core/store/brainStore';
import { Icon } from '@ui/icons';
import { regionForChunk } from '../../brain/data/memoryRegions';
import { buildMemoryGraph, type MemoryGraphCluster } from './memoryGraph';
import { graphBounds, layoutMemoryGraph, type GraphBounds, type NodePosition } from './layout';

const EXCERPT_CHARS = 280;
const LABEL_CHARS = 30;
const MIN_SCALE = 0.06;
const MAX_SCALE = 10;
const WHEEL_ZOOM_STEP = 1.14;
const CLICK_SLOP = 4; // px of movement below which a gesture counts as a click
const CLUSTER_COLORS = ['#3dd1bf', '#8b9eff', '#f5b971', '#7fdcab', '#64d2ff', '#c7a2ff', '#ff8da1', '#d7e06f'];

interface Transform {
  x: number;
  y: number;
  scale: number;
}

type Gesture =
  | { kind: 'pan'; px: number; py: number; tx: number; ty: number; moved: boolean }
  | { kind: 'node'; id: string; px: number; py: number; ox: number; oy: number; moved: boolean };

function nodeRadius(degree: number): number {
  return Math.min(11, 4 + Math.sqrt(Math.max(0, degree)) * 1.55);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function clusterStyle(color: string): CSSProperties {
  return { '--cluster-color': color } as CSSProperties;
}

function clusterColor(index: number): string {
  return CLUSTER_COLORS[index % CLUSTER_COLORS.length]!;
}

function clusterVisual(cluster: MemoryGraphCluster, positions: Map<string, NodePosition>) {
  const points = cluster.nodeIds.map((id) => positions.get(id)).filter(Boolean) as NodePosition[];
  if (points.length === 0) return null;
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const radius = Math.max(
    72,
    ...points.map((point) => Math.hypot(point.x - x, point.y - y) + 32),
  );
  return { x, y, radius };
}

export function MemoryGraphView({
  chunks,
  onRemove,
}: {
  chunks: RagChunk[];
  onRemove: (id: string) => void;
}) {
  const graph = useMemo(() => buildMemoryGraph(chunks), [chunks]);
  const clusterById = useMemo(
    () => new Map(graph.clusters.map((cluster) => [cluster.id, cluster])),
    [graph.clusters],
  );
  const nodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const clusterIndexById = useMemo(
    () => new Map(graph.clusters.map((cluster, index) => [cluster.id, index])),
    [graph.clusters],
  );

  // Lay the graph out in a virtual square sized by topic count and node count,
  // so the simulation never reruns on container resize — only fit changes.
  const span = useMemo(
    () => Math.max(1200, Math.sqrt(graph.nodes.length) * 110, Math.sqrt(graph.clusters.length) * 540),
    [graph.clusters.length, graph.nodes.length],
  );
  const layout = useMemo(() => layoutMemoryGraph(graph, span), [graph, span]);
  const bounds = useMemo(() => graphBounds(layout, span), [layout, span]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const link = (from: string, to: string) => {
      let set = map.get(from);
      if (!set) {
        set = new Set();
        map.set(from, set);
      }
      set.add(to);
    };
    for (const edge of graph.edges) {
      link(edge.source, edge.target);
      link(edge.target, edge.source);
    }
    return map;
  }, [graph.edges]);

  const [positions, setPositions] = useState<Map<string, NodePosition>>(layout);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);

  // Fit a bounding box into the current viewport.
  const fitBox = useCallback(
    (box: GraphBounds) => {
      if (size.w === 0 || size.h === 0) return;
      const pad = Math.min(96, Math.max(44, Math.min(size.w, size.h) * 0.09));
      const boxW = Math.max(box.maxX - box.minX, 1);
      const boxH = Math.max(box.maxY - box.minY, 1);
      const scale = Math.min(
        Math.max(Math.min((size.w - pad * 2) / boxW, (size.h - pad * 2) / boxH), MIN_SCALE),
        1.7,
      );
      setTransform({
        x: size.w / 2 - ((box.minX + box.maxX) / 2) * scale,
        y: size.h / 2 - ((box.minY + box.maxY) / 2) * scale,
        scale,
      });
    },
    [size.w, size.h],
  );

  // Reset node positions whenever the underlying graph relays out.
  useEffect(() => {
    setPositions(new Map(layout));
    setSelectedId(null);
    setSelectedClusterId(null);
  }, [layout]);

  // Frame the graph once the viewport is measured and after every relayout.
  useEffect(() => {
    fitBox(bounds);
  }, [bounds, fitBox]);

  // Track the container size.
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ w: rect.width, h: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Addressing a finding in the diagram lights its anatomical region on the
  // 3D brain — the memory diagram and the brain model are one brain.
  useEffect(() => {
    const node = selectedId ? graph.nodes.find((n) => n.id === selectedId) : null;
    useBrainStore.getState().setFocusRegion(node ? regionForChunk(node.chunk) : null);
  }, [selectedId, graph.nodes]);

  // Clear the focused region when the diagram unmounts.
  useEffect(() => () => useBrainStore.getState().setFocusRegion(null), []);

  // Non-passive wheel listener so zoom can preventDefault the page scroll.
  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    setTransform((prev) => {
      const scale = Math.min(Math.max(prev.scale * factor, MIN_SCALE), MAX_SCALE);
      const ratio = scale / prev.scale;
      return { x: px - (px - prev.x) * ratio, y: py - (py - prev.y) * ratio, scale };
    });
  }, []);

  const zoomFromCenter = (factor: number) => {
    zoomAt((size.w || 800) / 2, (size.h || 600) / 2, factor);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      zoomAt(px, py, event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const onBackgroundPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = localPoint(event);
    gestureRef.current = {
      kind: 'pan',
      px: point.x,
      py: point.y,
      tx: transform.x,
      ty: transform.y,
      moved: false,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onNodePointerDown = (event: ReactPointerEvent<SVGGElement>, id: string) => {
    event.stopPropagation();
    const point = localPoint(event);
    const origin = positions.get(id);
    if (!origin) return;
    gestureRef.current = {
      kind: 'node',
      id,
      px: point.x,
      py: point.y,
      ox: origin.x,
      oy: origin.y,
      moved: false,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const point = localPoint(event);
    const dx = point.x - gesture.px;
    const dy = point.y - gesture.py;
    if (!gesture.moved && Math.hypot(dx, dy) > CLICK_SLOP) gesture.moved = true;

    if (gesture.kind === 'pan') {
      setTransform((prev) => ({ ...prev, x: gesture.tx + dx, y: gesture.ty + dy }));
    } else {
      setPositions((prev) => {
        const next = new Map(prev);
        next.set(gesture.id, {
          x: gesture.ox + dx / transform.scale,
          y: gesture.oy + dy / transform.scale,
        });
        return next;
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    svgRef.current?.releasePointerCapture(event.pointerId);
    if (!gesture || gesture.moved) return;
    // A gesture that never moved is a click.
    if (gesture.kind === 'node') {
      setSelectedId((current) => (current === gesture.id ? null : gesture.id));
    } else {
      setSelectedId(null);
    }
  };

  const activeId = selectedId ?? hoverId;
  const activeNeighbors = activeId ? (neighbors.get(activeId) ?? new Set<string>()) : null;
  const selected = selectedId ? nodeById.get(selectedId) : undefined;
  const clusterVisuals = graph.clusters
    .map((cluster, index) => ({ cluster, index, visual: clusterVisual(cluster, positions) }))
    .filter((item): item is { cluster: MemoryGraphCluster; index: number; visual: NonNullable<ReturnType<typeof clusterVisual>> } =>
      item.visual !== null,
    );

  const nodeState = (id: string): 'normal' | 'lit' | 'dim' => {
    const node = nodeById.get(id);
    if (selectedClusterId && node?.clusterId !== selectedClusterId) return 'dim';
    if (selectedClusterId && !activeId) return 'lit';
    if (!activeId) return 'normal';
    if (id === activeId || (activeNeighbors?.has(id) ?? false)) return 'lit';
    return 'dim';
  };

  return (
    <div className="memory-graph" ref={wrapperRef}>
      <svg
        ref={svgRef}
        className="memory-graph-canvas"
        width={size.w || 800}
        height={size.h || 600}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {clusterVisuals.map(({ cluster, index, visual }) => {
            const active = selectedClusterId === cluster.id;
            const dim = selectedClusterId !== null && !active;
            return (
              <g
                key={cluster.id}
                className="memory-graph-cluster"
                data-active={active}
                data-dim={dim}
                transform={`translate(${visual.x} ${visual.y})`}
                style={clusterStyle(clusterColor(index))}
              >
                <circle className="memory-graph-cluster-halo" r={visual.radius} />
                <text
                  className="memory-graph-cluster-label"
                  y={-visual.radius - 14 / transform.scale}
                  fontSize={12 / transform.scale}
                >
                  {truncate(cluster.label, 42)}
                </text>
                <text
                  className="memory-graph-cluster-meta"
                  y={-visual.radius + 2 / transform.scale}
                  fontSize={9.5 / transform.scale}
                >
                  {cluster.nodeIds.length} nodes
                  {cluster.terms.length > 0 ? ` · ${cluster.terms.slice(0, 3).join(' / ')}` : ''}
                </text>
              </g>
            );
          })}
          {graph.edges.map((edge) => {
            const a = positions.get(edge.source);
            const b = positions.get(edge.target);
            if (!a || !b) return null;
            const sourceNode = nodeById.get(edge.source);
            const targetNode = nodeById.get(edge.target);
            const clusterMatch =
              selectedClusterId &&
              sourceNode?.clusterId === selectedClusterId &&
              targetNode?.clusterId === selectedClusterId;
            const edgeState = !activeId
              ? selectedClusterId
                ? clusterMatch
                  ? 'lit'
                  : 'dim'
                : 'normal'
              : edge.source === activeId || edge.target === activeId
                ? 'lit'
                : 'dim';
            return (
              <line
                key={`${edge.source}-${edge.target}`}
                className="memory-graph-edge"
                data-state={edgeState}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeWidth={(0.6 + edge.weight * 2.4) / transform.scale}
              >
                <title>{edge.label}</title>
              </line>
            );
          })}
          {graph.nodes.map((node) => {
            const point = positions.get(node.id);
            if (!point) return null;
            const radius = nodeRadius(node.degree);
            const state = nodeState(node.id);
            const clusterIndex = clusterIndexById.get(node.clusterId) ?? 0;
            const showLabel = state === 'lit' || node.chunk.kind === 'answer' || (!activeId && transform.scale >= 0.9);
            return (
              <g
                key={node.id}
                className="memory-graph-node"
                data-kind={node.chunk.kind}
                data-state={state}
                data-selected={node.id === selectedId}
                data-cluster={node.clusterId}
                transform={`translate(${point.x} ${point.y})`}
                style={clusterStyle(clusterColor(clusterIndex))}
                onPointerDown={(event) => onNodePointerDown(event, node.id)}
                onPointerEnter={() => setHoverId(node.id)}
                onPointerLeave={() => setHoverId((current) => (current === node.id ? null : current))}
              >
                <circle className="memory-graph-dot" r={radius} />
                {showLabel ? (
                  <text
                    className="memory-graph-label"
                    y={radius + 11 / transform.scale}
                    fontSize={11 / transform.scale}
                  >
                    {truncate(node.label, LABEL_CHARS)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="memory-graph-info">
        {graph.nodes.length} {graph.nodes.length === 1 ? 'node' : 'nodes'} ·{' '}
        {graph.edges.length} {graph.edges.length === 1 ? 'topic link' : 'topic links'} ·{' '}
        {graph.clusters.length} {graph.clusters.length === 1 ? 'cluster' : 'clusters'}
      </div>

      <div className="memory-graph-topics" aria-label="Topic clusters">
        <button
          type="button"
          data-active={selectedClusterId === null}
          onClick={() => setSelectedClusterId(null)}
        >
          All topics
        </button>
        {graph.clusters.slice(0, 8).map((cluster, index) => (
          <button
            type="button"
            key={cluster.id}
            data-active={selectedClusterId === cluster.id}
            onClick={() => setSelectedClusterId((current) => (current === cluster.id ? null : cluster.id))}
            style={clusterStyle(clusterColor(index))}
            title={cluster.terms.join(', ')}
          >
            <span className="memory-graph-topic-dot" />
            {truncate(cluster.label, 28)}
            <span>{cluster.nodeIds.length}</span>
          </button>
        ))}
      </div>

      <div className="memory-graph-controls">
        <span className="memory-graph-legend">
          <span className="memory-graph-swatch" data-kind="evidence" /> Topic evidence
          <span className="memory-graph-swatch" data-kind="answer" /> Answer
        </span>
        <span className="memory-graph-zoom-value">{Math.round(transform.scale * 100)}%</span>
        <button type="button" onClick={() => zoomFromCenter(1 / 1.28)} aria-label="Zoom out">
          <Icon name="minus" size={12} />
        </button>
        <button type="button" onClick={() => zoomFromCenter(1.28)} aria-label="Zoom in">
          <Icon name="plus" size={12} />
        </button>
        <button type="button" onClick={() => fitBox(bounds)}>
          <Icon name="refresh" size={12} /> Reset view
        </button>
      </div>

      {graph.edges.length === 0 && graph.nodes.length > 1 ? (
        <p className="memory-graph-hint">
          No strong topic links yet — findings need shared entities, topic phrases, or research runs to connect.
        </p>
      ) : null}

      {selected ? (
        <aside className="memory-graph-detail">
          <header>
            <span className="memory-kind" data-kind={selected.chunk.kind}>
              {selected.chunk.kind === 'answer' ? 'Answer' : 'Evidence'}
            </span>
            <button
              type="button"
              className="memory-graph-detail-close"
              onClick={() => setSelectedId(null)}
              aria-label="Close detail"
            >
              <Icon name="close" size={12} />
            </button>
          </header>
          <h4>{selected.chunk.title || 'Untitled'}</h4>
          <p className="memory-graph-detail-meta">
            <span>{selected.chunk.source}</span>
            <span>
              {selected.degree} {selected.degree === 1 ? 'topic link' : 'topic links'}
            </span>
          </p>
          <p className="memory-graph-detail-topic">
            Topic: {clusterById.get(selected.clusterId)?.label ?? 'Untitled topic'}
          </p>
          <p className="memory-graph-detail-text">
            {truncate(selected.chunk.text.replace(/\s+/g, ' ').trim(), EXCERPT_CHARS)}
          </p>
          <footer>
            {selected.chunk.url ? (
              <a href={selected.chunk.url} target="_blank" rel="noreferrer noopener">
                <Icon name="document" size={11} /> Source
              </a>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="memory-graph-detail-remove"
              onClick={() => {
                onRemove(selected.id);
                setSelectedId(null);
              }}
            >
              <Icon name="close" size={11} /> Delete
            </button>
          </footer>
        </aside>
      ) : null}
    </div>
  );
}
