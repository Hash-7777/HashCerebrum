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

  // NeuroGenetic background (ported from the HashCerebrum website): a slow DNA
  // double-helix sweeping across the screen with drifting gene base-pair
  // particles, tuned for the dark boot screen. Coordinates are in CSS pixels
  // (the context is scaled by the device pixel ratio so it stays crisp).
  useEffect(() => {
    const cv = fieldRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let W = 0;
    let H = 0;
    // Gene base colours: emerald, rose, blue, amber.
    const geneColors = ['#10b981', '#fb5d76', '#5b9dff', '#f0a94e'];
    const helixPoints = 55;
    const helixAmp = 55;
    const helixFreq = 0.018;
    let helixOffset = 0;
    let particles: Array<{ x: number; y: number; vx: number; vy: number; color: string; radius: number; pulse: number }> = [];

    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      W = innerWidth;
      H = innerHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(44, Math.round((W * H) / 38000));
      particles = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        color: geneColors[i % 4]!,
        radius: 1.5 + Math.random() * 2,
        pulse: Math.random() * Math.PI * 2,
      }));
    };

    const drawHelix = () => {
      const cy = H * 0.5;
      const startX = -30;
      const endX = W + 30;
      for (let s = 0; s < 2; s += 1) {
        ctx.beginPath();
        ctx.strokeStyle = s === 0 ? 'rgba(40, 168, 154, 0.16)' : 'rgba(70, 210, 188, 0.12)';
        ctx.lineWidth = 2;
        for (let x = startX; x <= endX; x += 3) {
          const phase = s * Math.PI + x * helixFreq - helixOffset;
          const y = cy + Math.sin(phase) * helixAmp;
          if (x === startX) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let i = 0; i < helixPoints; i += 1) {
        const x = startX + (i / helixPoints) * (endX - startX);
        const phase = i * 0.4 - helixOffset;
        const y1 = cy + Math.sin(phase) * helixAmp;
        const y2 = cy + Math.sin(phase + Math.PI) * helixAmp;
        const color = geneColors[i % 4]!;
        const opacity = 0.5 + 0.5 * Math.sin(phase * 0.5);
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.globalAlpha = opacity * 0.42;
        ctx.lineWidth = 1.8;
        ctx.moveTo(x, y1);
        ctx.lineTo(x, y2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        for (const y of [y1, y2]) {
          ctx.beginPath();
          ctx.fillStyle = color;
          ctx.globalAlpha = opacity * 0.7;
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    };

    const drawParticles = () => {
      for (const p of particles) {
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;
          p.pulse += 0.02;
          if (p.x < 0) p.x = W;
          if (p.x > W) p.x = 0;
          if (p.y < 0) p.y = H;
          if (p.y > H) p.y = 0;
        }
        const opacity = Math.max(0, 0.22 + Math.sin(p.pulse) * 0.16);
        ctx.beginPath();
        ctx.fillStyle = p.color;
        ctx.globalAlpha = opacity;
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      drawHelix();
      drawParticles();
      if (!reduced) helixOffset += 0.006;
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

      <div className="boot-disclaimer" role="note">
        <strong>For research &amp; education only.</strong> Not a medical device and not medical advice —
        always verify outputs with a qualified healthcare professional.
      </div>
    </div>
  );
}
