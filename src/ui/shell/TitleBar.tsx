import { APP_NAME, APP_VERSION } from '@config/constants';
import { Icon } from '@ui/icons';
import { platform } from '@platform/index';
import { useBrainModesStore } from '@core/store/brainModesStore';
import { useLiteMode } from '@ui/hooks/useLiteMode';
import logoMark from '@/assets/logo-mark.png';

const maskStyle = {
  WebkitMaskImage: `url(${logoMark})`,
  maskImage: `url(${logoMark})`,
} as React.CSSProperties;

function focusSearch() {
  document.querySelector<HTMLInputElement>('.search-input')?.focus();
}

function openSettings() {
  window.dispatchEvent(new CustomEvent('hc:open-settings'));
}

function toggleTrace() {
  window.dispatchEvent(new CustomEvent('hc:toggle-trace'));
}

function restartApp() {
  void platform().app.relaunch();
}

export function TitleBar() {
  // 3D ⇄ 2D view toggle, surfaced in the toolbar for one-click access. The Lite
  // preference drives the Brain workspace: 'on' = 2D pipeline, 'off' = 3D brain,
  // 'auto' = 2D only on weak hardware. Clicking forces the opposite explicit mode.
  const setLite = useBrainModesStore((s) => s.setLite);
  const is2D = useLiteMode();
  const toggleView = () => setLite(is2D ? 'off' : 'on');

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand">
        <span className="logo logo-mask" style={maskStyle} aria-hidden="true" />
        <span>{APP_NAME}</span>
        <span className="version">v{APP_VERSION}</span>
      </div>
      <div className="spacer" />
      <div className="titlebar-right">
        <button
          className="icon-btn view-toggle"
          type="button"
          data-on={is2D}
          title={is2D ? '2D pipeline view — switch to 3D brain' : '3D brain view — switch to 2D pipeline'}
          aria-label={is2D ? 'Switch to 3D brain view' : 'Switch to 2D pipeline view'}
          aria-pressed={is2D}
          onClick={toggleView}
        >
          {is2D ? '2D' : '3D'}
        </button>
        <button className="icon-btn" type="button" title="Search (⌘F)" aria-label="Search" onClick={focusSearch}>
          <Icon name="search" size={15} />
        </button>
        <button className="icon-btn" type="button" title="Execution trace" aria-label="Execution trace" onClick={toggleTrace}>
          <Icon name="activity" size={15} />
        </button>
        <button className="icon-btn" type="button" title="Settings (⌘,)" aria-label="Settings" onClick={openSettings}>
          <Icon name="settings" size={15} />
        </button>
        <button className="icon-btn" type="button" title="Restart app" aria-label="Restart app" onClick={restartApp}>
          <Icon name="refresh" size={15} />
        </button>
      </div>
    </header>
  );
}
