import { APP_NAME, APP_VERSION } from '@config/constants';
import logoMark from '@/assets/logo-mark.png';

export function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <img className="titlebar-mark" src={logoMark} alt="" aria-hidden="true" />
      <span className="titlebar-brand">{APP_NAME}</span>
      <span className="titlebar-version">v{APP_VERSION}</span>
    </header>
  );
}
