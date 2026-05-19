import { useState } from 'react';
import type { RegionId } from '@config/agents';
import { BrainCanvas } from './components/BrainCanvas';
import { useLitRegions } from './useLitRegions';

export function BrainMode() {
  const [selectedRegion, setSelectedRegion] = useState<RegionId | null>(null);
  const regions = useLitRegions();

  return (
    <div className="mode brain-mode">
      <div className="brain-stage">
        <BrainCanvas selectedRegion={selectedRegion} onSelectRegion={setSelectedRegion} />
        <section className="brain-hero">
          <p className="eyebrow">HashCerebrum Atlas</p>
          <h1>Brain</h1>
          <p className="model-line">Agent signal map scaffold</p>
        </section>
      </div>

      <aside className="brain-legend" aria-label="Brain regions">
        <header>
          <h3>Regions</h3>
          <span>Atlas pins</span>
        </header>
        <ul>
          {regions.map((region) => (
            <li
              key={region.id}
              data-active={region.intensity > 0.05}
              data-selected={selectedRegion === region.id}
            >
              <button type="button" onClick={() => setSelectedRegion(region.id)}>
                <span className="dot" style={{ background: region.emissive }} />
                <span className="label">{region.label}</span>
                <span className="desc">{region.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
