// First-run loading splash. A calm, clinical loading screen: the brand mark
// over a soft ambient field, a single live status line, a clean progress bar,
// and a "Ready → Enter" gate. Uses the app's bundled fonts so it stays fully
// offline / CSP-clean.

import { useCallback, useEffect, useRef, useState } from 'react';
import logoMark from '@/assets/logo-mark.png';
import { APP_VERSION } from '@config/constants';

const DURATION = 3.0; // seconds

// The phases shown, one at a time, on the status line as the app warms up.
const STEPS = [
  'Establishing encrypted session',
  'Waking the Cerebrum',
  'Indexing research corpus',
  'Preparing the agent team',
  'Calibrating peer review',
  'Verifying provenance & trust chain',
];

export function BootSplash({ onEnter }: { onEnter: () => void }) {
  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [step, setStep] = useState(reduced ? STEPS.length - 1 : 0);
  const [pct, setPct] = useState(reduced ? 100 : 0);
  const [ready, setReady] = useState(reduced);
  const [exiting, setExiting] = useState(false);
  const fieldRef = useRef<HTMLCanvasElement>(null);

  // Ambient drifting particle field (very subtle — adds depth, not noise).
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
      const n = Math.round((innerWidth * innerHeight) / 60000);
      seeds = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        s: (1 + Math.random() * 1.4) * dpr,
        vx: (Math.random() - 0.5) * 0.04 * dpr,
        vy: (Math.random() * 0.05 + 0.015) * dpr,
        a: 0.03 + Math.random() * 0.05,
        tw: Math.random() * Math.PI * 2,
      }));
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of seeds) {
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;
          p.tw += 0.008;
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

  // Boot timeline: ramp progress and advance the status line, then go Ready.
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

    const startAt = 600;
    const gap = (total - startAt - 200) / STEPS.length;
    STEPS.forEach((_, i) => {
      timers.push(window.setTimeout(() => setStep(i), startAt + i * gap));
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
    window.setTimeout(onEnter, 850); // let the exit transition play
  }, [ready, exiting, onEnter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') doEnter();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [doEnter]);

  return (
    <div
      className={`boot${ready ? ' ready' : ''}${exiting ? ' exiting' : ''}`}
      role="status"
      aria-label="Loading HashCerebrum"
    >
      <canvas ref={fieldRef} className="boot-field" aria-hidden="true" />
      <div className="boot-vignette" aria-hidden="true" />

      <main className="boot-stage">
        <div className="boot-emblem">
          <img src={logoMark} alt="HashCerebrum" draggable={false} />
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
          <div className="field">Medical Research Workspace</div>
        </div>

        <div className="boot-progress">
          <div className="boot-status" aria-live="polite">
            <span className="boot-status-dot" />
            <span className="boot-status-text">{ready ? 'Ready' : `${STEPS[step]}…`}</span>
          </div>
          <div className="boot-track">
            <div className="boot-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="boot-pct">{Math.round(pct)}%</div>
        </div>

        <div className="boot-enter-wrap">
          <button type="button" className={`boot-enter${ready ? ' ready' : ''}`} onClick={doEnter}>
            Enter <span className="arr">→</span>
          </button>
          <div className={`boot-hint${ready ? ' ready' : ''}`}>
            press <kbd>↵</kbd> to enter
          </div>
        </div>
      </main>
    </div>
  );
}
