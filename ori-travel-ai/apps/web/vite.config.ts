/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev proxy target for the FastAPI backend. Override with VITE_API_TARGET when
// port 8000 is taken (e.g. VITE_API_TARGET=http://127.0.0.1:8010 npm run dev).
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: false,
    proxy: {
      '/api': {
        target: apiTarget,
        // Keep the browser's Host header: the API's Origin check compares the
        // request Origin with Host for same-origin unsafe requests.
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    target: 'es2023',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
});
