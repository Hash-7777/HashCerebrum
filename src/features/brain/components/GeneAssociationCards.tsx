import { useEffect, useState } from 'react';
import type { ConfidenceBand, GeneAssociation } from '../swarm/genetics/associationConfidence';

// One hue per confidence band, carried through the gauge, the score, and the pill.
const BAND_COLOR: Record<ConfidenceBand, string> = {
  insufficient: '#7f8ea8',
  weak: '#e3bd63',
  moderate: '#8b9eff',
  strong: '#44c98b',
  'very strong': '#3dd1bf',
};

type Direction = GeneAssociation['confidence']['pooledDirection'];
const DIRECTION: Record<Direction, { text: string; cls: string }> = {
  risk: { text: '↑ Risk', cls: 'gene-dir--risk' },
  protective: { text: '↓ Protective', cls: 'gene-dir--protective' },
  mixed: { text: '↔ Mixed direction', cls: 'gene-dir--mixed' },
  none: { text: 'No clear direction', cls: 'gene-dir--none' },
};

/** Ease-out count-up from 0 to `target`, started once `run` turns true. */
function useCountUp(target: number, run: boolean): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const start = performance.now();
    const duration = 850;
    const tick = (now: number): void => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) * (1 - p);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return value;
}

function GaugeRing({ score, color }: { score: number; color: string }): JSX.Element {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFilled(true), 60);
    return () => clearTimeout(t);
  }, []);
  const shown = useCountUp(score, filled);
  const offset = filled ? circumference * (1 - Math.max(0, Math.min(100, score)) / 100) : circumference;
  return (
    <svg className="gene-gauge" viewBox="0 0 80 80" role="img" aria-label={`${score} percent`}>
      <circle className="gene-gauge-track" cx="40" cy="40" r={radius} />
      <circle
        className="gene-gauge-fill"
        cx="40"
        cy="40"
        r={radius}
        style={{ stroke: color, strokeDasharray: circumference, strokeDashoffset: offset }}
      />
      <text className="gene-gauge-num" x="40" y="42" style={{ fill: color }}>
        {shown}
      </text>
      <text className="gene-gauge-pct" x="40" y="55">
        %
      </text>
    </svg>
  );
}

/**
 * Graded association-confidence cards for a Genetics-mode result — one card per
 * gene, each with an animated gauge filling to the app-computed score, the band,
 * the pooled direction, and the plain rationale. A made-up gene renders as an
 * "unrecognized" card with no score.
 */
export function GeneAssociationCards({ associations }: { associations: GeneAssociation[] }): JSX.Element | null {
  if (!associations || associations.length === 0) return null;
  return (
    <div className="gene-cards">
      {associations.map((a, i) => {
        const color = a.recognized ? BAND_COLOR[a.confidence.band] : '#e2696e';
        const style = { '--band': color, animationDelay: `${i * 90}ms` } as React.CSSProperties;
        if (!a.recognized) {
          return (
            <div key={`${a.gene}-${i}`} className="gene-card gene-card--unrecognized" style={style}>
              <div className="gene-gauge gene-gauge--none" aria-hidden="true">
                <span>?</span>
              </div>
              <div className="gene-card-body">
                <div className="gene-card-head">
                  <span className="gene-card-name">{a.gene || 'Variant'}</span>
                  <span className="gene-band-pill gene-band-pill--warn">unrecognized</span>
                </div>
                <p className="gene-card-rationale">
                  Not an approved human gene symbol (HGNC), so no association can be scored.
                </p>
              </div>
            </div>
          );
        }
        const dir = DIRECTION[a.confidence.pooledDirection];
        return (
          <div key={`${a.gene}-${i}`} className="gene-card" style={style}>
            <GaugeRing score={a.confidence.score} color={color} />
            <div className="gene-card-body">
              <div className="gene-card-head">
                <span className="gene-card-name">{a.gene || 'Variant'}</span>
                <span className="gene-band-pill">{a.confidence.band}</span>
              </div>
              <div className="gene-card-chips">
                <span className={`gene-dir ${dir.cls}`}>{dir.text}</span>
                <span className="gene-card-count">
                  {a.confidence.supportCount} supporting record{a.confidence.supportCount === 1 ? '' : 's'}
                </span>
              </div>
              <p className="gene-card-rationale">{a.confidence.rationale}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
