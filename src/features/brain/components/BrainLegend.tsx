import type { RegionId } from '@config/agents';
import { Icon } from '@ui/icons';
import type { LitRegion } from '../useLitRegions';

export function BrainLegend({
  regions,
  selectedRegion,
  onSelectRegion,
}: {
  regions: LitRegion[];
  selectedRegion: RegionId | null;
  onSelectRegion: (region: RegionId) => void;
}) {
  const active = regions.filter((region) => region.intensity > 0.05).length;
  return (
    <section className="brain-legend" aria-label="Brain regions">
      <header>
        <h3>
          <Icon name="brain" size={12} /> Linked regions
        </h3>
        <span>{active} active</span>
      </header>
      <ul>
        {regions.map((region) => (
          <li key={region.id} data-active={region.intensity > 0.05} data-selected={selectedRegion === region.id}>
            <button type="button" onClick={() => onSelectRegion(region.id)}>
              <span className="dot" style={{ background: region.emissive }} aria-hidden="true" />
              <span className="label">{region.label}</span>
              <span className="desc">{region.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
