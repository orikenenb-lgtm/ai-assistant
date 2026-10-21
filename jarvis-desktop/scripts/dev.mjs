// מצב פיתוח: Vite dev server ל-renderer + esbuild watch ל-main/preload + Electron.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBin = require('electron');
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');
const DEV_URL = 'http://127.0.0.1:5173';

const children = [];
const run = (cmd, args, env = {}) => {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, shell: false });
  children.push(child);
  return child;
};

run(process.execPath, [viteBin]);
run(process.execPath, [resolve(root, 'scripts/build-main.mjs'), '--watch'], { NODE_ENV: 'development' });

async function waitForVite() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(DEV_URL);
      if (res.ok) return;
    } catch {
      // השרת עוד לא עלה — מנסים שוב
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Vite dev server did not start');
}

await waitForVite();
await new Promise((r) => setTimeout(r, 1200));
const app = run(electronBin, ['.'], { JARVIS_DEV_SERVER_URL: DEV_URL, NODE_ENV: 'development' });
app.on('exit', (code) => {
  for (const c of children) if (c !== app) c.kill();
  process.exit(code ?? 0);
});
