import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppShell } from '@ui/shell/AppShell';
import { BootSplash } from '@ui/shell/BootSplash';
import { RootErrorBoundary } from '@ui/errors/RootErrorBoundary';
import { ErrorOverlay } from '@ui/errors/ErrorConsole';
import { setPlatform } from '@platform/index';
import { revealWindow } from '@platform/revealWindow';
import { tauriPlatform } from '@platform/tauri';
import { browserPlatform } from '@platform/browser';
import { registerMedicalTools } from '@core/tools/medical';
import { registerMemoryTools } from '@core/tools/memory';
import { installErrorCapture } from '@core/store/errorLogStore';
// Self-hosted fonts — served from node_modules by Vite, no external network
// requests. Replaces the Google Fonts <link> that the Tauri CSP was blocking
// (font-src 'self' data: does not cover fonts.gstatic.com).
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/400-italic.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/newsreader/300.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/600.css';
import '@fontsource/newsreader/700.css';
import '@fontsource/newsreader/300-italic.css';
import '@fontsource/newsreader/400-italic.css';
import '@fontsource/newsreader/500-italic.css';
import '@fontsource/source-sans-3/300.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/500.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/300-italic.css';
import '@fontsource/source-sans-3/400-italic.css';
import '@fontsource/source-serif-4/300.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/500.css';
import '@fontsource/source-serif-4/300-italic.css';
import '@fontsource/source-serif-4/400-italic.css';
import './styles/globals.css';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

// Detect runtime. The Tauri global is injected by the runtime when running
// under the desktop shell. In `vite dev` (browser) we fall back to mock.
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
setPlatform(isTauri ? tauriPlatform : browserPlatform);
installErrorCapture();
registerMedicalTools();
registerMemoryTools();

// The app shell mounts immediately (and warms up behind the splash) so it is
// ready the instant the user clicks Enter. The boot splash overlays it on
// launch and fades out on Enter.
function Root() {
  const [entered, setEntered] = React.useState(false);
  return (
    <>
      <AppShell />
      <ErrorOverlay />
      {!entered && <BootSplash onEnter={() => setEntered(true)} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <Root />
    </RootErrorBoundary>
  </React.StrictMode>,
);

// The native window is created hidden (tauri.conf.json) so the WebView's white
// default never flashes on launch. The boot splash reveals it once it has
// actually painted (reliable timing); this is only a safety net so the window
// can never be left hidden if that path is somehow starved.
if (isTauri) setTimeout(revealWindow, 2500);
