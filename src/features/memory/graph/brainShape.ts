// A 2-D brain silhouette — two overlapping hemispheres with a central
// longitudinal fissure. The memory graph is laid out inside this shape so the
// finished diagram reads as a single brain rather than scattered blobs, and
// the same geometry is drawn behind the nodes. All coordinates live in the
// layout's virtual span × span space.

export interface BrainEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface BrainBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BrainShape {
  span: number;
  left: BrainEllipse;
  right: BrainEllipse;
  fissureX: number;
  fissureTop: number;
  fissureBottom: number;
  bounds: BrainBounds;
  /** True when (x, y) lies inside either hemisphere. */
  contains(x: number, y: number): boolean;
  /** The point itself if inside, otherwise the nearest point just inside. */
  clampInside(x: number, y: number): { x: number; y: number };
  /** `count` seed points spread through the brain interior, one per topic. */
  anchors(count: number): { x: number; y: number }[];
}

/** Squared normalized radius — <= 1 means the point is inside the ellipse. */
function ellipseNorm(e: BrainEllipse, x: number, y: number): number {
  const nx = (x - e.cx) / e.rx;
  const ny = (y - e.cy) / e.ry;
  return nx * nx + ny * ny;
}

/** Radially project a point onto an ellipse, landing slightly inside it. */
function projectInto(e: BrainEllipse, x: number, y: number): { x: number; y: number } {
  const nx = (x - e.cx) / e.rx;
  const ny = (y - e.cy) / e.ry;
  const d = Math.hypot(nx, ny) || 1e-6;
  const k = 0.985 / d;
  return { x: e.cx + nx * k * e.rx, y: e.cy + ny * k * e.ry };
}

export function brainShape(span: number): BrainShape {
  const cx = span / 2;
  const cy = span / 2;
  const offset = span * 0.135; // hemisphere separation
  const rx = span * 0.275;
  const ry = span * 0.365;
  const left: BrainEllipse = { cx: cx - offset, cy, rx, ry };
  const right: BrainEllipse = { cx: cx + offset, cy, rx, ry };

  const contains = (x: number, y: number): boolean =>
    ellipseNorm(left, x, y) <= 1 || ellipseNorm(right, x, y) <= 1;

  const clampInside = (x: number, y: number): { x: number; y: number } => {
    if (contains(x, y)) return { x, y };
    const candidateLeft = projectInto(left, x, y);
    const candidateRight = projectInto(right, x, y);
    const distLeft = Math.hypot(candidateLeft.x - x, candidateLeft.y - y);
    const distRight = Math.hypot(candidateRight.x - x, candidateRight.y - y);
    return distLeft <= distRight ? candidateLeft : candidateRight;
  };

  const anchors = (count: number): { x: number; y: number }[] => {
    if (count <= 1) return [{ x: cx, y: cy }];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const r = span * 0.27 * Math.sqrt(t);
      const angle = i * goldenAngle;
      // Stretch vertically a little — the brain is taller than it is wide.
      out.push(clampInside(cx + r * Math.cos(angle), cy + r * Math.sin(angle) * 1.18));
    }
    return out;
  };

  return {
    span,
    left,
    right,
    fissureX: cx,
    fissureTop: cy - ry * 0.92,
    fissureBottom: cy + ry * 0.92,
    bounds: {
      minX: left.cx - rx,
      minY: cy - ry,
      maxX: right.cx + rx,
      maxY: cy + ry,
    },
    contains,
    clampInside,
    anchors,
  };
}
