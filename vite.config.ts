import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri expects a fixed dev port and clear-cut HMR config.
// See https://tauri.app/start/frontend/vite/
const host = process.env['TAURI_DEV_HOST'];

export default defineConfig({
  plugins: react(),

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, './src/core'),
      '@agents': path.resolve(__dirname, './src/agents'),
      '@modes': path.resolve(__dirname, './src/modes'),
      '@features': path.resolve(__dirname, './src/features'),
      '@platform': path.resolve(__dirname, './src/platform'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@config': path.resolve(__dirname, './src/config'),
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
    target: process.env['TAURI_ENV_PLATFORM'] === 'windows' ? 'chrome105' : 'safari13',
    // Vite 8 uses Rolldown + OXC (Rust-based). Passing true uses OXC minification;
    // 'esbuild' is no longer bundled and requires a separate install.
    minify: !process.env['TAURI_ENV_DEBUG'],
    sourcemap: !!process.env['TAURI_ENV_DEBUG'],
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Rollup 4 (Vite 8) requires manualChunks to be a function, not an object.
      manualChunks(id: string) {
          if (id.includes('/node_modules/@react-three/')) return 'r3f';
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react/')) return 'react';
          if (id.includes('/node_modules/zustand/')) return 'zustand';
          if (id.includes('/node_modules/xlsx/')) return 'xlsx';
          if (id.includes('/node_modules/jspdf/')) return 'jspdf';
        },
      },
    },
  },
});
