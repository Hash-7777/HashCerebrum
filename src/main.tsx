import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppShell } from '@ui/shell/AppShell';
import { setPlatform } from '@platform/index';
import { tauriPlatform } from '@platform/tauri';
import { browserPlatform } from '@platform/browser';
import { registerMedicalTools } from '@core/tools/medical';
import { registerMemoryTools } from '@core/tools/memory';
import './styles/globals.css';

// Detect runtime. The Tauri global is injected by the runtime when running
// under the desktop shell. In `vite dev` (browser) we fall back to mock.
const isTauri = typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
setPlatform(isTauri ? tauriPlatform : browserPlatform);
registerMedicalTools();
registerMemoryTools();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
