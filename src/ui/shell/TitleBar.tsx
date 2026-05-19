// Custom title bar for macOS Overlay window style. Drag region wires
// data-tauri-drag-region; the traffic lights are drawn by Tauri.

import { APP_NAME, APP_VERSION } from '@config/constants';

export function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="brand">{APP_NAME}</span>
      <span className="version">v{APP_VERSION}</span>
    </header>
  );
}
