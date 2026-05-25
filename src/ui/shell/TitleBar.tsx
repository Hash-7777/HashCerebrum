import { APP_NAME, APP_VERSION } from '@config/constants';
import { Icon } from '@ui/icons';
import { platform } from '@platform/index';
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
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand">
        <span className="logo logo-mask" style={maskStyle} aria-hidden="true" />
        <span>{APP_NAME}</span>
        <span className="version">v{APP_VERSION}</span>
      </div>
      <div className="spacer" />
      <div className="titlebar-right">
        <button className="icon-btn" type="button" title="Search (⌘F)" onClick={focusSearch}>
          <Icon name="search" size={15} />
        </button>
        <button className="icon-btn" type="button" title="Execution trace" onClick={toggleTrace}>
          <Icon name="activity" size={15} />
        </button>
        <button className="icon-btn" type="button" title="Settings (⌘,)" onClick={openSettings}>
          <Icon name="settings" size={15} />
        </button>
        <button className="icon-btn" type="button" title="Restart app" onClick={restartApp}>
          <Icon name="refresh" size={15} />
        </button>
      </div>
    </header>
  );
}
