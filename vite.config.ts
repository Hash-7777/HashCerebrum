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

  envPrefix: ['VITE_', 'TAURI_ENV_*'],

  build: {
    target: process.env['TAURI_ENV_PLATFORM'] === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env['TAURI_ENV_DEBUG'] ? 'esbuild' : false,
    sourcemap: !!process.env['TAURI_ENV_DEBUG'],
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing'],
          react: ['react', 'react-dom'],
          zustand: ['zustand'],
        },
      },
    },
  },
});
