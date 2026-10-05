import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ה-renderer נבנה כאתר סטטי שנטען דרך פרוטוקול app:// (לא file://).
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
});
