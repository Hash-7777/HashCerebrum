// A 2-D brain silhouette as a polar shape. The memory graph is laid out
// freely, then every node is warped through `mapInto` so the point cloud
// itself fills a single brain outline — the dots form the brain, with no
// drawn shape behind them. All coordinates live in the layout's virtual
// span × span space.

export interface BrainBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BrainShape {
  span: number;
  bounds: BrainBounds;
  /** Brain outline radius at a given angle (radians). */
  radiusAt(theta: number): number;
  /** Map a normalized disc coordinate (magnitude 0..1) into the brain shape. */
  mapInto(discX: number, discY: number): { x: number; y: number };
}

export function brainShape(span: number): BrainShape {
  const cx = span / 2;
  const cy = span / 2;
  const r0 = span * 0.42;
  const rx = r0 * 0.78; // narrower than tall — a brain is longer front-to-back
  const ry = r0;
  const front = -Math.PI / 2; // the frontal pole sits at the top

  const radiusAt = (theta: number): number => {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const ellipse = (rx * ry) / Math.sqrt((ry * c) ** 2 + (rx * s) ** 2);
    // A soft midline cleft at the frontal pole — the two frontal lobes — so
    // the outline reads as a brain, not an egg.
    let delta = Math.abs(theta - front);
    delta = Math.min(delta, Math.PI * 2 - delta);
    const cleft = 0.17 * r0 * Math.exp(-((delta / 0.42) ** 2));
    // A gentle taper at the occipital pole (the back).
    let deltaBack = Math.abs(theta - Math.PI / 2);
    deltaBack = Math.min(deltaBack, Math.PI * 2 - deltaBack);
    const taper = 0.07 * r0 * Math.exp(-((deltaBack / 0.7) ** 2));
    return ellipse - cleft - taper;
  };

  const mapInto = (discX: number, discY: number): { x: number; y: number } => {
    const radius = Math.min(1, Math.hypot(discX, discY));
    const theta = Math.atan2(discY, discX);
    const reach = radiusAt(theta);
    return {
      x: cx + Math.cos(theta) * radius * reach,
      y: cy + Math.sin(theta) * radius * reach,
    };
  };

  return {
    span,
    bounds: { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry },
    radiusAt,
    mapInto,
  };
}
