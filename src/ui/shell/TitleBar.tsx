import { APP_NAME, APP_VERSION } from '@config/constants';
import { Icon } from '@ui/icons';
import logoMark from '@/assets/logo-mark.png';

const maskStyle = {
  WebkitMaskImage: `url(${logoMark})`,
  maskImage: `url(${logoMark})`,
} as React.CSSProperties;

export function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="traffic" aria-hidden="true">
        <span className="tl-r" />
        <span className="tl-y" />
        <span className="tl-g" />
      </div>
      <div className="brand">
        <span className="logo logo-mask" style={maskStyle} aria-hidden="true" />
        <span>{APP_NAME}</span>
        <span className="version">v{APP_VERSION}</span>
      </div>
      <div className="spacer" />
      <div className="titlebar-right">
        <button className="icon-btn" type="button" title="Search">
          <Icon name="search" size={15} />
        </button>
        <button className="icon-btn" type="button" title="Activity">
          <Icon name="activity" size={15} />
        </button>
        <button className="icon-btn" type="button" title="Settings">
          <Icon name="settings" size={15} />
        </button>
      </div>
    </header>
  );
}
