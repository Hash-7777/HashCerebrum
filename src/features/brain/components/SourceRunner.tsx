import type { RegionId } from '@config/agents';
import { partColor, partForRegion } from '../data/modelParts';
import { regionById } from '../data/regions';
import { SOURCE_DEFS, type SourceDef } from '../data/sources';
import { Icon, type IconName } from '@ui/icons';

export type SourceState = 'idle' | 'running' | 'done' | 'error';

export interface SourceStatus extends SourceDef {
  state: SourceState;
  count: number;
  detail?: string;
}

export const INITIAL_SOURCES: SourceStatus[] = SOURCE_DEFS.map((s) => ({ ...s, state: 'idle', count: 0 }));

function colorFor(source: SourceStatus) {
  const part = partForRegion(source.region);
  return part ? partColor(part) : regionById(source.region).emissive;
}

const STATE_ICON: Record<SourceState, IconName> = {
  idle: 'pulse',
  running: 'spinner',
  done: 'check',
  error: 'alert',
};

export function SourceRunner({
  statuses,
  evidenceCount,
  onSelectRegion,
}: {
  statuses: SourceStatus[];
  evidenceCount: number;
  onSelectRegion: (region: RegionId) => void;
}) {
  return (
    <section className="source-runner" aria-label="Medical source status">
      <header>
        <h3>
          <Icon name="database" size={12} /> Sources
        </h3>
        <span>{evidenceCount} records</span>
      </header>
      <ul>
        {statuses.map((source) => (
          <li key={source.id} data-state={source.state}>
            <span className="source-swatch" style={{ background: colorFor(source) }} aria-hidden="true" />
            <button type="button" onClick={() => onSelectRegion(source.region)}>
              <span className="source-row-head">
                <Icon name={source.icon} size={13} />
                <strong>{source.label}</strong>
                <span className="source-state-icon" data-state={source.state} aria-hidden="true">
                  <Icon name={STATE_ICON[source.state]} size={12} />
                </span>
              </span>
              <span className="source-row-detail">{source.detail ?? source.state}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type { SourceDef } from '../data/sources';
