import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri expects a fixed dev port and clear-cut HMR config.
// See https://tauri.app/start/frontend/vite/
const host = process.env['TAURI_DEV_HOST'];

export default defineConfig({
  plugins: react(),

  // A per-build identity stamped into the bundle. The persisted execution trace
  // is tagged with it, so a freshly built app no longer matches an older build's
  // trace and starts clean — while a normal close/relaunch of the same build
  // keeps it. Evaluated once per build (and once per dev-server start).
  define: {
    __HC_BUILD_ID__: JSON.stringify(String(Date.now())),
  },

  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@core': path.resolve(import.meta.dirname, './src/core'),
      '@agents': path.resolve(import.meta.dirname, './src/agents'),
      '@modes': path.resolve(import.meta.dirname, './src/modes'),
      '@features': path.resolve(import.meta.dirname, './src/features'),
      '@platform': path.resolve(import.meta.dirname, './src/platform'),
      '@ui': path.resolve(import.meta.dirname, './src/ui'),
      '@lib': path.resolve(import.meta.dirname, './src/lib'),
      '@config': path.resolve(import.meta.dirname, './src/config'),
    },
  },

  // Vite options tailored for Tauri development.
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },

  // Expose only the single TAURI_ENV_DEBUG flag — not the entire TAURI_ENV_*
  // namespace, which would leak any accidental TAURI_ENV_* CI vars into the bundle.
  envPrefix: ['VITE_', 'TAURI_ENV_DEBUG'],

  build: {
    // Safari 14 is the WebKit of macOS 11, the app's minimumSystemVersion in
    // tauri.conf.json — the oldest engine a release can run on. Keep the two in step.
    target: process.env['TAURI_ENV_PLATFORM'] === 'windows' ? 'chrome105' : 'safari14',
    // Vite 8 uses Rolldown + OXC (Rust-based). Passing true uses OXC minification;
    // 'esbuild' is no longer bundled and requires a separate install.
    minify: !process.env['TAURI_ENV_DEBUG'],
    sourcemap: !!process.env['TAURI_ENV_DEBUG'],
    chunkSizeWarningLimit: 1200,
    // No manual vendor chunks. The desktop app ships its assets locally, so
    // splitting vendors buys no caching, and the old groups cost start-up: they
    // pulled three.js (with React, into one shared chunk) and jsPDF into what
    // the entry preloads. The default split keeps them in the lazy chunks of
    // the code that uses them — three.js with BrainCanvas, jsPDF with export.
  },
});
