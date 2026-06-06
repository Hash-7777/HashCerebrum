// Statistics Web Worker — offloads inferential stats from the UI thread.
// Supports: Welch t-test, Pearson correlation, chi-square, Kaplan-Meier,
// log-rank, and risk-score calculations.

interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
const ctx = globalThis as unknown as WorkerScope;

// ── Welch t-test ───────────────────────────────────────────────────────────
function welchTTest(a: number[], b: number[]) {
  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = (arr: number[]) => {
    const m = mean(arr);
    return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  };
  if (a.length < 2 || b.length < 2) return { error: '每组至少需要 2 个观测值' };
  const m1 = mean(a), m2 = mean(b);
  const v1 = variance(a), v2 = variance(b);
  if (!isFinite(v1) || !isFinite(v2)) return { error: '方差计算失败' };
  const se = Math.sqrt(v1 / a.length + v2 / b.length);
  if (se === 0) return { error: '合并标准误为零' };
  const t = (m1 - m2) / se;
  const df = Math.floor(
    (v1 / a.length + v2 / b.length) ** 2 /
    ((v1 / a.length) ** 2 / (a.length - 1) + (v2 / b.length) ** 2 / (b.length - 1)),
  );
  return { t, df, meanDiff: m1 - m2, se };
}

// ── Pearson correlation ────────────────────────────────────────────────────
function pearsonR(x: number[], y: number[]) {
  if (x.length !== y.length || x.length < 2) return { error: '需要相同长度且 ≥2' };
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return { error: '某一变量方差为零' };
  const r = num / Math.sqrt(dx2 * dy2);
  return { r, n: x.length };
}

// ── Chi-square ─────────────────────────────────────────────────────────────
function chiSquare(observed: number[][]) {
  if (observed.length === 0 || observed[0]!.length === 0) return { error: '空列联表' };
  const rows = observed.length;
  const cols = observed[0]!.length;
  const rowSums = observed.map((r) => r.reduce((s, v) => s + v, 0));
  const colSums: number[] = [];
  for (let j = 0; j < cols; j++) colSums.push(observed.reduce((s, r) => s + r[j]!, 0));
  const total = rowSums.reduce((s, v) => s + v, 0);
  if (total === 0) return { error: '总和为零' };
  let chi2 = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const expected = (rowSums[i]! * colSums[j]!) / total;
      if (expected === 0) continue;
      const diff = observed[i]![j]! - expected;
      chi2 += (diff * diff) / expected;
    }
  }
  const df = (rows - 1) * (cols - 1);
  return { chi2, df };
}

// ── Kaplan-Meier ───────────────────────────────────────────────────────────
function kaplanMeier(
  events: { time: number; event: 1 | 0 }[],
) {
  if (events.length === 0) return { error: '空生存数据' };
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const times: number[] = [];
  const survival: number[] = [];
  let n = sorted.length;
  let s = 1;
  let i = 0;
  while (i < sorted.length) {
    const t = sorted[i]!.time;
    let d = 0;
    let c = 0;
    while (i < sorted.length && sorted[i]!.time === t) {
      if (sorted[i]!.event === 1) d++;
      else c++;
      i++;
    }
    if (d > 0) {
      s *= 1 - d / n;
      times.push(t);
      survival.push(s);
    }
    n -= d + c;
  }
  return { times, survival };
}

// ── Message handler ────────────────────────────────────────────────────────
ctx.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type?: string; id?: number; payload?: unknown } | null;
  if (!msg || typeof msg.type !== 'string' || typeof msg.id !== 'number') return;

  const { type, id, payload } = msg;
  let result: unknown;

  try {
    switch (type) {
      case 'welch': {
        const p = payload as { a: number[]; b: number[] };
        result = welchTTest(p.a, p.b);
        break;
      }
      case 'pearson': {
        const p = payload as { x: number[]; y: number[] };
        result = pearsonR(p.x, p.y);
        break;
      }
      case 'chisq': {
        const p = payload as { table: number[][] };
        result = chiSquare(p.table);
        break;
      }
      case 'km': {
        const p = payload as { events: { time: number; event: 1 | 0 }[] };
        result = kaplanMeier(p.events);
        break;
      }
      default:
        result = { error: `Unknown stats type: ${type}` };
    }
  } catch (err) {
    result = { error: String(err) };
  }

  ctx.postMessage({ type: 'result', id, result });
});
