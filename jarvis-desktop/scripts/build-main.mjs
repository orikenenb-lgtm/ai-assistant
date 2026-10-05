// בונה את תהליך main ואת ה-preload לקבצי CommonJS בודדים (כולל התלויות), בלי node_modules בזמן ריצה.
import { build, context } from 'esbuild';
import { rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const isDev = watch || process.env.NODE_ENV === 'development';

rmSync(resolve(root, 'dist/main'), { recursive: true, force: true });
rmSync(resolve(root, 'dist/preload'), { recursive: true, force: true });
mkdirSync(resolve(root, 'dist'), { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: isDev ? 'inline' : false,
  external: ['electron', '@picovoice/porcupine-node'],
  logLevel: 'info',
  define: {
    'process.env.JARVIS_BUILD_MODE': JSON.stringify(isDev ? 'development' : 'production'),
  },
};

const configs = [
  { ...common, entryPoints: [resolve(root, 'src/main/main.ts')], outfile: resolve(root, 'dist/main/main.cjs') },
  // ה-preload רץ ב-sandbox: חייב להיות קובץ אחד בלי require לספריות חיצוניות.
  { ...common, entryPoints: [resolve(root, 'src/preload/preload.ts')], outfile: resolve(root, 'dist/preload/preload.cjs'), platform: 'browser', format: 'cjs', target: 'chrome140' },
];

if (watch) {
  for (const cfg of configs) {
    const ctx = await context(cfg);
    await ctx.watch();
  }
  console.log('[build-main] watching…');
} else {
  await Promise.all(configs.map((cfg) => build(cfg)));
}
