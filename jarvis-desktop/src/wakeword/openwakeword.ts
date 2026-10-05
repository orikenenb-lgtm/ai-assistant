/**
 * פורט ל-TypeScript של צינור הזיהוי של openWakeWord (github.com/dscripka/openWakeWord, Apache-2.0),
 * מבוסס על openwakeword/utils.py (AudioFeatures) ו-openwakeword/model.py (Model.predict).
 *
 * הצינור, לכל 1280 דגימות (80ms ב-16kHz):
 *   1) melspectrogram.onnx על 1280+480 הדגימות האחרונות (ערכי int16 גולמיים כ-float32) → x/10+2
 *   2) embedding_model.onnx על חלון של 76 מסגרות mel אחרונות → וקטור 96
 *   3) מודל מילת ההפעלה (hey_jarvis_v0.1.onnx) על 16 הווקטורים האחרונים → ציון 0..1
 *   5 החיזויים הראשונים מאופסים (כמו במקור).
 *
 * הקוד לא תלוי בסביבת ריצה: מקבל sessions של ONNX מוזרקים (onnxruntime-web ב-renderer, וגם בבדיקות).
 * המודלים המאומנים מגיעים ברישיון CC BY-NC-SA 4.0 (שימוש אישי, לא מסחרי) — ראה THIRD_PARTY_NOTICES.md.
 */

export interface TensorLike {
  readonly data: ArrayLike<number>;
  readonly dims: readonly number[];
}

export interface SessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>>;
}

export type TensorFactory = (data: Float32Array, dims: number[]) => TensorLike;

/** מתאם ל-InferenceSession של onnxruntime (web/node): הטנזורים שנוצרים ב-TensorFactory הם טנזורים של ort. */
export function adaptOrtSession(session: {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- טיפוסי ה-feeds של ort ספציפיים לגרסה; ההתאמה נבדקת בבדיקות ההתאמה
  run(feeds: any): Promise<any>;
}): SessionLike {
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    run: (feeds) => session.run(feeds) as Promise<Record<string, TensorLike>>,
  };
}

export const SAMPLE_RATE = 16_000;
export const CHUNK_SAMPLES = 1280;
const MEL_CONTEXT = 160 * 3;
const MEL_BINS = 32;
const MEL_WINDOW = 76;
const MEL_STEP = 8;
const MEL_MAX_FRAMES = 10 * 97;
const EMBEDDING_DIM = 96;
const FEATURE_MAX = 120;
const WARMUP_PREDICTIONS = 5;

export interface OpenWakeWordSessions {
  melspectrogram: SessionLike;
  embedding: SessionLike;
  wakeword: SessionLike;
}

/** מחולל פסאודו-אקראי דטרמיניסטי (LCG) לאתחול חיץ התכונות ברעש — כמו np.random במקור. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export class OpenWakeWordPipeline {
  private melBuffer: Float32Array[] = [];
  private featureBuffer: Float32Array[] = [];
  private rawTail = new Float32Array(0);
  private pending = new Float32Array(0);
  private predictions = 0;
  private readonly wakewordFrames: number;
  /** תכונות הרעש הדטרמיניסטיות לאתחול — מחושבות פעם אחת (≈200ms של ONNX) ומועתקות בכל reset. */
  private seedFeatures: Float32Array[] | null = null;

  constructor(
    private readonly sessions: OpenWakeWordSessions,
    private readonly tensor: TensorFactory,
    private readonly seed = 1234,
  ) {
    // מספר מסגרות התכונות שהמודל מצפה להן נקרא מהמודל עצמו במקור; ל-hey_jarvis הוא 16
    this.wakewordFrames = 16;
  }

  /**
   * איפוס מלא (כמו Model.reset): חיצים, מונה חיזויים ואתחול ברעש.
   * הרעש דטרמיניסטי (seed קבוע), ולכן גם התכונות שלו — הן מחושבות רק באיפוס הראשון.
   * האיפוס נקרא בכל חזרה מהשהיה (פעמיים בכל תור קולי), ובלי המטמון הוא חוסם את ה-thread הראשי.
   */
  async reset(): Promise<void> {
    this.melBuffer = Array.from({ length: MEL_WINDOW }, () => new Float32Array(MEL_BINS).fill(1));
    this.rawTail = new Float32Array(0);
    this.pending = new Float32Array(0);
    this.predictions = 0;
    if (!this.seedFeatures) {
      const rand = lcg(this.seed);
      const noise = new Float32Array(SAMPLE_RATE * 4);
      for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(rand() * 2000) - 1000;
      this.seedFeatures = await this.embeddingsForAudio(noise);
    }
    this.featureBuffer = this.seedFeatures.map((f) => f.slice());
  }

  /**
   * מקבל דגימות int16 (כ-Float32Array של ערכים -32768..32767 או Int16Array).
   * מחזיר ציון לכל מקטע מלא של 1280 דגימות שהושלם.
   */
  async push(samples: ArrayLike<number>): Promise<number[]> {
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending, 0);
    for (let i = 0; i < samples.length; i++) merged[this.pending.length + i] = samples[i] ?? 0;
    const scores: number[] = [];
    let offset = 0;
    while (merged.length - offset >= CHUNK_SAMPLES) {
      scores.push(await this.processChunk(merged.subarray(offset, offset + CHUNK_SAMPLES)));
      offset += CHUNK_SAMPLES;
    }
    this.pending = merged.slice(offset);
    return scores;
  }

  private async processChunk(chunk: Float32Array): Promise<number> {
    // חיץ גולמי: מספיקות 1280+480 הדגימות האחרונות
    const keep = CHUNK_SAMPLES + MEL_CONTEXT;
    const raw = new Float32Array(Math.min(this.rawTail.length + chunk.length, keep));
    const fromTail = raw.length - chunk.length;
    if (fromTail > 0) raw.set(this.rawTail.subarray(this.rawTail.length - fromTail), 0);
    raw.set(chunk, Math.max(0, fromTail));
    this.rawTail = raw;

    const frames = await this.melspectrogram(raw);
    for (const f of frames) this.melBuffer.push(f);
    if (this.melBuffer.length > MEL_MAX_FRAMES) this.melBuffer = this.melBuffer.slice(-MEL_MAX_FRAMES);

    if (this.melBuffer.length >= MEL_WINDOW) {
      const window = this.melBuffer.slice(-MEL_WINDOW);
      const emb = await this.embedBatch([window]);
      this.featureBuffer.push(...emb);
      if (this.featureBuffer.length > FEATURE_MAX) this.featureBuffer = this.featureBuffer.slice(-FEATURE_MAX);
    }

    const feats = this.featureBuffer.slice(-this.wakewordFrames);
    const input = new Float32Array(this.wakewordFrames * EMBEDDING_DIM);
    feats.forEach((f, i) => input.set(f, i * EMBEDDING_DIM));
    const ww = this.sessions.wakeword;
    const out = await ww.run({ [ww.inputNames[0]!]: this.tensor(input, [1, this.wakewordFrames, EMBEDDING_DIM]) });
    let score = Number(out[ww.outputNames[0]!]?.data[0] ?? 0);
    if (this.predictions < WARMUP_PREDICTIONS) score = 0;
    this.predictions++;
    return score;
  }

  /** מריץ את מודל ה-mel ומחזיר מסגרות (כל אחת 32 ערכים) אחרי x/10+2. */
  private async melspectrogram(samples: Float32Array): Promise<Float32Array[]> {
    const mel = this.sessions.melspectrogram;
    const out = await mel.run({ [mel.inputNames[0]!]: this.tensor(Float32Array.from(samples), [1, samples.length]) });
    const t = out[mel.outputNames[0]!]!;
    const data = t.data;
    const frameCount = Math.floor(data.length / MEL_BINS);
    const frames: Float32Array[] = [];
    for (let f = 0; f < frameCount; f++) {
      const row = new Float32Array(MEL_BINS);
      for (let b = 0; b < MEL_BINS; b++) row[b] = Number(data[f * MEL_BINS + b]) / 10 + 2;
      frames.push(row);
    }
    return frames;
  }

  private async embedBatch(windows: Float32Array[][]): Promise<Float32Array[]> {
    const emb = this.sessions.embedding;
    const input = new Float32Array(windows.length * MEL_WINDOW * MEL_BINS);
    windows.forEach((w, wi) => w.forEach((row, ri) => input.set(row, (wi * MEL_WINDOW + ri) * MEL_BINS)));
    const out = await emb.run({ [emb.inputNames[0]!]: this.tensor(input, [windows.length, MEL_WINDOW, MEL_BINS, 1]) });
    const data = out[emb.outputNames[0]!]!.data;
    const result: Float32Array[] = [];
    for (let i = 0; i < windows.length; i++) {
      const v = new Float32Array(EMBEDDING_DIM);
      for (let d = 0; d < EMBEDDING_DIM; d++) v[d] = Number(data[i * EMBEDDING_DIM + d]);
      result.push(v);
    }
    return result;
  }

  /** תכונות לאודיו שלם (לאתחול): mel על הכול, חלונות של 76 בצעדים של 8. */
  private async embeddingsForAudio(samples: Float32Array): Promise<Float32Array[]> {
    const frames = await this.melspectrogram(samples);
    const windows: Float32Array[][] = [];
    for (let i = 0; i + MEL_WINDOW <= frames.length; i += MEL_STEP) windows.push(frames.slice(i, i + MEL_WINDOW));
    return windows.length ? this.embedBatch(windows) : [];
  }
}

/** ממיר דגימות float (-1..1) לטווח int16 שהמודלים מצפים לו. */
export function floatToInt16Range(input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return out;
}

/**
 * החלטת הפעלה: ציון מעל סף, עם השהיית "קירור" כדי שהפעלה אחת לא תיספר פעמיים.
 * רגישות גבוהה = סף נמוך. ברירת המחדל (0.5) תואמת את הסף המומלץ במקור.
 */
export class WakeDecider {
  private lastFireMs = -Infinity;
  constructor(
    private sensitivity: number,
    private readonly cooldownMs = 2000,
  ) {}

  get threshold(): number {
    return Math.min(0.9, Math.max(0.1, 1 - this.sensitivity));
  }

  setSensitivity(s: number): void {
    this.sensitivity = s;
  }

  /** מחזיר true אם צריך להפעיל עכשיו. */
  update(score: number, nowMs: number): boolean {
    if (score < this.threshold) return false;
    if (nowMs - this.lastFireMs < this.cooldownMs) return false;
    this.lastFireMs = nowMs;
    return true;
  }
}
