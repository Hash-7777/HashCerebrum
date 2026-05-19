import { APP_NAME, APP_VERSION } from '@config/constants';
import { Icon } from '@ui/icons';

export function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-mark" aria-hidden="true">
        <Icon name="brain" size={16} />
      </span>
      <span className="titlebar-brand">{APP_NAME}</span>
      <span className="titlebar-version">v{APP_VERSION}</span>
    </header>
  );
}
