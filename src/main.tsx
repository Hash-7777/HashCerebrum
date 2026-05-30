import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppShell } from '@ui/shell/AppShell';
import { RootErrorBoundary } from '@ui/errors/RootErrorBoundary';
import { setPlatform } from '@platform/index';
import { tauriPlatform } from '@platform/tauri';
import { browserPlatform } from '@platform/browser';
import { registerMedicalTools } from '@core/tools/medical';
import { registerMemoryTools } from '@core/tools/memory';
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

// Detect runtime. The Tauri global is injected by the runtime when running
// under the desktop shell. In `vite dev` (browser) we fall back to mock.
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
setPlatform(isTauri ? tauriPlatform : browserPlatform);
registerMedicalTools();
registerMemoryTools();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AppShell />
    </RootErrorBoundary>
  </React.StrictMode>,
);
