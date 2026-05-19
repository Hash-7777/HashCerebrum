import { MODES } from '@config/modes';
import { useModeStore } from '@core/store/modeStore';

export function ModeRail() {
  const mode = useModeStore((s) => s.mode);
  const setMode = useModeStore((s) => s.setMode);

  return (
    <nav className="mode-rail" aria-label="Mode navigation">
      {MODES.map((m) => (
        <button
          key={m.id}
          className="mode-rail-btn"
          data-active={mode === m.id}
          onClick={() => setMode(m.id)}
          title={`${m.description} (${m.shortcut})`}
        >
          <span className="mode-label">{m.label}</span>
          <span className="mode-shortcut">{m.shortcut}</span>
        </button>
      ))}
    </nav>
  );
}
