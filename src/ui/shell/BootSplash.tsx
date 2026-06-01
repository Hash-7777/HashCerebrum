// First-run loading splash. The brand logo mark is the animated centerpiece,
// set over an ambient particle field, with a glassy boot console, a progress
// trace, and a "Ready → Enter" gate. Uses the app's bundled fonts so it stays
// fully offline / CSP-clean.

import { useCallback, useEffect, useRef, useState } from 'react';
import logoMark from '@/assets/logo-mark.png';
import { APP_VERSION } from '@config/constants';

const DURATION = 3.0; // seconds

const ROWS: Array<{ msg: string; t: string }> = [
  { msg: 'Establishing encrypted session', t: '46ms' },
  { msg: 'Waking the Cerebrum', t: '118ms' },
  { msg: 'Indexing research corpus', t: '232ms' },
  { msg: 'Spinning up agent swarm · 8 specialists', t: '164ms' },
  { msg: 'Calibrating peer review', t: '93ms' },
  { msg: 'Verifying provenance & trust chain', t: '71ms' },
];

interface RowState {
  shown: boolean;
  done: boolean;
}

export function BootSplash({ onEnter }: { onEnter: () => void }) {
  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [rows, setRows] = useState<RowState[]>(() =>
    ROWS.map(() => ({ shown: reduced, done: reduced })),
  );
  const [pct, setPct] = useState(reduced ? 100 : 0);
  const [ready, setReady] = useState(reduced);
  const [exiting, setExiting] = useState(false);
  const fieldRef = useRef<HTMLCanvasElement>(null);

  // Ambient drifting particle field (very subtle).
  useEffect(() => {
    const cv = fieldRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let seeds: Array<{ x: number; y: number; s: number; vx: number; vy: number; a: number; tw: number }> = [];
    const resize = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = cv.width = innerWidth * dpr;
      h = cv.height = innerHeight * dpr;
      cv.style.width = `${innerWidth}px`;
      cv.style.height = `${innerHeight}px`;
      const n = Math.round((innerWidth * innerHeight) / 42000);
      seeds = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        s: (1.1 + Math.random() * 1.8) * dpr,
        vx: (Math.random() - 0.5) * 0.05 * dpr,
        vy: (Math.random() * 0.06 + 0.02) * dpr,
        a: 0.04 + Math.random() * 0.07,
        tw: Math.random() * Math.PI * 2,
      }));
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of seeds) {
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;
          p.tw += 0.01;
          if (p.y > h + 4) p.y = -4;
          if (p.x < -4) p.x = w + 4;
          if (p.x > w + 4) p.x = -4;
        }
        const a = p.a * (0.6 + 0.4 * Math.sin(p.tw));
        ctx.fillStyle = `rgba(95,227,192,${a.toFixed(3)})`;
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }
      raf = requestAnimationFrame(draw);
    };
    resize();
    addEventListener('resize', resize);
    draw();
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
    };
  }, [reduced]);

  // Boot timeline: reveal + complete rows, ramp progress, then go Ready.
  useEffect(() => {
    if (reduced) return;
    const timers: number[] = [];
    let raf = 0;
    const total = DURATION * 1000;

    const t0 = performance.now();
    const ramp = (now: number) => {
      const t = Math.min(1, (now - t0) / total);
      setPct(Math.min(99, (1 - Math.pow(1 - t, 1.7)) * 100));
      if (t < 1) raf = requestAnimationFrame(ramp);
    };
    raf = requestAnimationFrame(ramp);

    const startRows = 1000;
    const gap = (total - 1000 - 260) / ROWS.length;
    ROWS.forEach((_, i) => {
      timers.push(
        window.setTimeout(() => {
          setRows((prev) => prev.map((r, j) => (j === i ? { ...r, shown: true } : r)));
        }, startRows + i * gap),
      );
      timers.push(
        window.setTimeout(() => {
          setRows((prev) => prev.map((r, j) => (j === i ? { ...r, done: true } : r)));
        }, startRows + i * gap + gap * 0.78),
      );
    });

    timers.push(
      window.setTimeout(() => {
        setPct(100);
        setReady(true);
      }, total + 240),
    );

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [reduced]);

  const doEnter = useCallback(() => {
    if (!ready || exiting) return;
    setExiting(true);
    window.setTimeout(onEnter, 950); // let the exit transition play
  }, [ready, exiting, onEnter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') doEnter();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [doEnter]);

  return (
    <div className={`boot${ready ? ' ready' : ''}${exiting ? ' exiting' : ''}`} role="status" aria-label="Loading HashCerebrum">
      <canvas ref={fieldRef} className="boot-field" aria-hidden="true" />
      <div className="boot-vignette" aria-hidden="true" />
      <div className="boot-grain" aria-hidden="true" />

      <main className="boot-stage">
        <div className="boot-emblem">
          <img src={logoMark} alt="HashCerebrum" draggable={false} />
          <span className="boot-spark s1" aria-hidden="true" />
          <span className="boot-spark s2" aria-hidden="true" />
          <span className="boot-spark s3" aria-hidden="true" />
          <span className="boot-spark s4" aria-hidden="true" />
        </div>

        <div className="boot-brand">
          <h1>
            <span className="hash">Hash</span>Cerebrum
          </h1>
          <span className="ver">v{APP_VERSION}</span>
        </div>

        <div className="boot-tagline">
          <div className="kicker">
            Private<span className="dot">·</span>Agentic<span className="dot">·</span>Trusted
          </div>
          <div className="field">Medical Research</div>
        </div>

        <section className="boot-console" aria-label="Boot sequence">
          <div className="head">
            <div className="stat">
              <span className="led" />
              <span>{ready ? 'SYSTEM · READY' : 'SYSTEM · BOOT'}</span>
            </div>
            <span>v{APP_VERSION}</span>
          </div>
          <div className="rows">
            {ROWS.map((row, i) => {
              const state = rows[i]!;
              return (
                <div key={row.msg} className={`boot-row${state.shown ? ' show' : ''}${state.done ? ' done' : ''}`}>
                  <span className="ic" aria-hidden="true">
                    {state.done ? <span className="boot-check">✓</span> : <span className="boot-spinner" />}
                  </span>
                  <span className="msg">{row.msg}</span>
                  <span className="t">{row.t}</span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="boot-prog">
          <div className="track">
            <div className="fill" style={{ right: `${100 - pct}%` }} />
          </div>
          <div className="pct">{Math.round(pct)}%</div>
        </div>

        <div className="boot-enter-wrap">
          <button type="button" className={`boot-enter${ready ? ' ready' : ''}`} onClick={doEnter}>
            Enter HashCerebrum <span className="arr">→</span>
          </button>
          <div className={`boot-hint${ready ? ' ready' : ''}`}>
            press <kbd>↵</kbd> to enter
          </div>
        </div>
      </main>
    </div>
  );
}
