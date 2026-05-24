import { MODES, type ModeId } from '@config/modes';
import { useModeStore } from '@core/store/modeStore';
import { Icon, type IconName } from '@ui/icons';

const MODE_ICONS: Record<ModeId, IconName> = {
  brain: 'brain',
  memory: 'database',
  peer_review: 'shield',
};

export function ModeRail() {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);

  return (
    <nav className="mode-rail" aria-label="Mode navigation">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className="mode-rail-btn"
          data-active={mode === m.id}
          onClick={() => setMode(m.id)}
          title={`${m.description} (${m.shortcut})`}
        >
          <span className="mode-rail-icon" aria-hidden="true">
            <Icon name={MODE_ICONS[m.id as ModeId] ?? 'brain'} size={16} />
          </span>
          <span className="mode-rail-label">{m.label}</span>
          <span className="mode-rail-shortcut">{m.shortcut}</span>
        </button>
      ))}
    </nav>
  );
}
