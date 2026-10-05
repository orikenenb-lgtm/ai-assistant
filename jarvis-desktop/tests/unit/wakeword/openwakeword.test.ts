import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as ort from 'onnxruntime-web';
import { CHUNK_SAMPLES, OpenWakeWordPipeline, WakeDecider, adaptOrtSession, floatToInt16Range, type OpenWakeWordSessions } from '../../../src/wakeword/openwakeword';

/**
 * בדיקת התאמה (parity) בין הפורט ל-TypeScript לבין מימוש הייחוס של openWakeWord ב-Python.
 * ציוני הייחוס חושבו מראש עם openwakeword (inference_framework='onnx') על אותם קבצי WAV
 * (קול סינתטי של espeak-ng) ונשמרו ב-tests/fixtures/wakeword/reference_scores.json.
 * המודלים עצמם מורדים ע"י `npm run fetch-models` (מאומתים ב-SHA-256).
 */

const root = resolve(__dirname, '..', '..', '..');
const modelDir = join(root, 'src', 'renderer', 'public', 'models', 'openwakeword');
const fixtures = join(root, 'tests', 'fixtures', 'wakeword');
const haveModels = existsSync(join(modelDir, 'hey_jarvis_v0.1.onnx'));

function readWavInt16(file: string): Float32Array {
  const buf = readFileSync(file);
  // חיפוש מקטע data (WAV PCM 16-bit מונו 16kHz)
  let off = 12;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(off + 8 + i * 2);
      return out;
    }
    off += 8 + size;
  }
  throw new Error('no data chunk');
}

const reference = JSON.parse(readFileSync(join(fixtures, 'reference_scores.json'), 'utf8')) as Record<string, number[]>;

let sessions: OpenWakeWordSessions;
const tensor = (data: Float32Array, dims: number[]) => new ort.Tensor('float32', data, dims);

async function scoresFor(file: string): Promise<number[]> {
  const p = new OpenWakeWordPipeline(sessions, tensor);
  await p.reset();
  const audio = readWavInt16(join(fixtures, file));
  const out: number[] = [];
  // הזנה במקטעים של 1280 בדיוק, כמו בסקריפט הייחוס
  for (let i = 0; i + CHUNK_SAMPLES <= audio.length; i += CHUNK_SAMPLES) {
    out.push(...(await p.push(audio.subarray(i, i + CHUNK_SAMPLES))));
  }
  return out;
}

describe.skipIf(!haveModels)('openWakeWord TypeScript port (parity with the Python reference)', () => {
  beforeAll(async () => {
    ort.env.wasm.numThreads = 1;
    const load = async (name: string) => adaptOrtSession(await ort.InferenceSession.create(readFileSync(join(modelDir, name))));
    sessions = {
      melspectrogram: await load('melspectrogram.onnx'),
      embedding: await load('embedding_model.onnx'),
      wakeword: await load('hey_jarvis_v0.1.onnx'),
    };
  }, 60_000);

  it('detects "hey jarvis" (synthetic voice) like the reference, at the same moment', async () => {
    const ours = await scoresFor('hey_jarvis_espeak.wav');
    const ref = reference['hey_jarvis_espeak.wav']!;
    expect(ours.length).toBe(ref.length);
    const ourPeak = ours.indexOf(Math.max(...ours));
    const refPeak = ref.indexOf(Math.max(...ref));
    expect(Math.max(...ours)).toBeGreaterThan(0.9);
    expect(Math.abs(ourPeak - refPeak)).toBeLessThanOrEqual(1);
    // אחרי שהחיץ האקראי ההתחלתי מתחלף בתכונות אמיתיות (~16 מסגרות) הציונים צריכים להתאים
    for (let i = 20; i < ref.length; i++) expect(Math.abs(ours[i]! - ref[i]!), `frame ${i}`).toBeLessThan(0.05);
  }, 60_000);

  it('stays silent on a Hebrew command (no false activation)', async () => {
    const ours = await scoresFor('hebrew_command_espeak.wav');
    expect(Math.max(...ours)).toBeLessThan(0.1);
    expect(Math.max(...reference['hebrew_command_espeak.wav']!)).toBeLessThan(0.1);
  }, 60_000);

  it('"jarvis" alone stays below the default threshold — the model needs "hey jarvis"', async () => {
    const ours = await scoresFor('jarvis_only_espeak.wav');
    expect(Math.max(...ours)).toBeLessThan(0.5);
  }, 60_000);

  it('zeroes the first five predictions after reset (as the reference does)', async () => {
    const ours = await scoresFor('hey_jarvis_espeak.wav');
    expect(ours.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
  }, 60_000);

  it('accepts arbitrary chunk sizes (streaming from 128-sample audio blocks)', async () => {
    const p = new OpenWakeWordPipeline(sessions, tensor);
    await p.reset();
    const audio = readWavInt16(join(fixtures, 'hey_jarvis_espeak.wav'));
    const out: number[] = [];
    for (let i = 0; i < audio.length; i += 128) out.push(...(await p.push(audio.subarray(i, Math.min(i + 128, audio.length)))));
    expect(out.length).toBe(Math.floor(audio.length / CHUNK_SAMPLES));
    expect(Math.max(...out)).toBeGreaterThan(0.9);
  }, 60_000);
});

describe('wake decision', () => {
  it('maps sensitivity to a threshold and debounces repeated activations', () => {
    const d = new WakeDecider(0.5, 2000);
    expect(d.threshold).toBeCloseTo(0.5);
    expect(d.update(0.4, 0)).toBe(false);
    expect(d.update(0.8, 100)).toBe(true);
    expect(d.update(0.9, 900)).toBe(false);
    expect(d.update(0.9, 2200)).toBe(true);
    d.setSensitivity(0.8);
    expect(d.threshold).toBeCloseTo(0.2);
  });

  it('converts float audio to the int16 range expected by the models', () => {
    expect(Array.from(floatToInt16Range(new Float32Array([0, 1, -1, 2, -2])))).toEqual([0, 32767, -32768, 32767, -32768]);
  });
});
