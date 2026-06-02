import { MODES, type ModeId } from '@config/modes';
import { useModeStore } from '@core/store/modeStore';
import { Icon, type IconName } from '@ui/icons';

const MODE_ICONS: Record<ModeId, IconName> = {
  brain: 'brain',
  memory: 'database',
  peer_review: 'shield',
  drug_interactions: 'pill',
};

export function ModeRail() {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);

  return (
    <nav className="modes" aria-label="Mode navigation">
      <div className="modes-label">Modules</div>
      {MODES.map((m, i) => (
        <button
          key={m.id}
          type="button"
          className={`mode-tab${mode === m.id ? ' active' : ''}`}
          onClick={() => setMode(m.id)}
          title={`${m.description} (${m.shortcut})`}
        >
          <div className="mode-mark" aria-hidden="true">
            <Icon name={MODE_ICONS[m.id as ModeId] ?? 'brain'} size={14} />
          </div>
          <div className="mode-content">
            <div className="mode-label">{m.label}</div>
          </div>
          <div className="hotkey">⌘{i + 1}</div>
        </button>
      ))}
    </nav>
  );
}
