// מוריד את מודלי מילת ההפעלה (Wake word) ומאמת אותם לפי SHA-256 קבוע.
// המודלים לא נשמרים ב-Git (קבצים בינאריים של צד שלישי עם רישיון משלהם — ראה THIRD_PARTY_NOTICES.md).
// הקבצים נכנסים לתיקיית public של ה-renderer ומוגשים מקומית דרך app:// — בלי רשת בזמן ריצה.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'src', 'renderer', 'public');

const MODELS = [
  {
    file: 'models/openwakeword/melspectrogram.onnx',
    url: 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx',
    sha256: 'ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f',
  },
  {
    file: 'models/openwakeword/embedding_model.onnx',
    url: 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx',
    sha256: '70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f',
  },
  {
    file: 'models/openwakeword/hey_jarvis_v0.1.onnx',
    url: 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/hey_jarvis_v0.1.onnx',
    sha256: '94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb',
  },
  {
    file: 'models/porcupine/porcupine_params.pv',
    url: 'https://raw.githubusercontent.com/Picovoice/porcupine/v4.0/lib/common/porcupine_params.pv',
    sha256: '0b0685f170c5e73259fb45c32f481b100cdffb8ef6a4d87be871519c8d17df36',
  },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchWithRetry(url, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
  throw lastErr;
}

let failed = false;
for (const m of MODELS) {
  const target = join(publicDir, m.file);
  if (existsSync(target) && sha256(readFileSync(target)) === m.sha256) {
    console.log(`✓ ${m.file} (קיים ומאומת)`);
    continue;
  }
  try {
    const data = await fetchWithRetry(m.url);
    const digest = sha256(data);
    if (digest !== m.sha256) throw new Error(`SHA-256 mismatch: ${digest}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    console.log(`↓ ${m.file} (${data.length} bytes, מאומת)`);
  } catch (err) {
    failed = true;
    console.error(`✗ ${m.file}: ${err instanceof Error ? err.message : err}`);
  }
}

if (failed) {
  console.error('חלק מהמודלים לא הורדו. מילת ההפעלה לא תעבוד עד שההורדה תצליח; שאר JARVIS עובד כרגיל.');
  process.exit(1);
}
