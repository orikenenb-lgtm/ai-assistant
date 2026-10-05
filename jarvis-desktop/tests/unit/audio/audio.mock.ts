/**
 * MOCK — סביבת אודיו מדומה לבדיקות ב-node: טיימרים, MediaStream, גרף מיקרופון,
 * AudioContext להשמעה ו-speechSynthesis. שום דבר כאן לא מדבר עם חומרה אמיתית.
 */
import type { MicGraph, MicGraphHandlers } from '../../../src/renderer/audio/mic-capture';
import type { AudioTimers } from '../../../src/renderer/audio/timers';

/* ------------------------------------------------------------------ */
/* טיימרים                                                              */
/* ------------------------------------------------------------------ */

export interface MockTimers extends AudioTimers {
  advance(ms: number): void;
  readonly pendingCount: number;
}

export function mockTimers(start = 0): MockTimers {
  let now = start;
  let nextId = 1;
  const tasks = new Map<number, { at: number; callback: () => void; interval: number | null }>();
  return {
    now: () => now,
    setTimeout(callback, ms) {
      const id = nextId++;
      tasks.set(id, { at: now + Math.max(0, ms), callback, interval: null });
      return id;
    },
    clearTimeout(handle) {
      tasks.delete(handle as number);
    },
    setInterval(callback, ms) {
      const id = nextId++;
      const interval = Math.max(1, ms);
      tasks.set(id, { at: now + interval, callback, interval });
      return id;
    },
    clearInterval(handle) {
      tasks.delete(handle as number);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let dueId: number | null = null;
        let due: { at: number; callback: () => void; interval: number | null } | null = null;
        for (const [id, task] of tasks) {
          if (task.at <= target && (!due || task.at < due.at)) {
            due = task;
            dueId = id;
          }
        }
        if (!due || dueId === null) break;
        now = due.at;
        if (due.interval !== null) due.at += due.interval;
        else tasks.delete(dueId);
        due.callback();
      }
      now = target;
    },
    get pendingCount() {
      return tasks.size;
    },
  };
}

/** נותן להבטחות שממתינות להתקדם (כמה סבבי microtask + macrotask). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* ------------------------------------------------------------------ */
/* MediaStream / tracks                                                 */
/* ------------------------------------------------------------------ */

export class MockTrack {
  readyState: 'live' | 'ended' = 'live';
  stopCalls = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  stop(): void {
    // כמו בדפדפן: stop() לא יורה 'ended'
    this.stopCalls++;
    this.readyState = 'ended';
  }
  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  /** מדמה ניתוק התקן. */
  unplug(): void {
    this.readyState = 'ended';
    for (const l of [...(this.listeners.get('ended') ?? [])]) l();
  }
}

export function mockStream(trackCount = 1): { stream: MediaStream; tracks: MockTrack[] } {
  const tracks = Array.from({ length: trackCount }, () => new MockTrack());
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
  return { stream: stream as unknown as MediaStream, tracks };
}

/* ------------------------------------------------------------------ */
/* גרף מיקרופון                                                         */
/* ------------------------------------------------------------------ */

export interface MockMicGraph extends MicGraph {
  readonly handlers: MicGraphHandlers;
  closeCalls: number;
  level: number;
  /** שולח דגימות כאילו הגיעו מה-worklet, במקטעים. */
  emit(samples: Float32Array, chunkSize?: number): void;
}

export function mockMicGraphFactory(sampleRate = 16_000): {
  openGraph: (stream: MediaStream, handlers: MicGraphHandlers) => Promise<MicGraph>;
  graphs: MockMicGraph[];
  calls: number;
} {
  const state = {
    graphs: [] as MockMicGraph[],
    calls: 0,
    openGraph: async (_stream: MediaStream, handlers: MicGraphHandlers): Promise<MicGraph> => {
      state.calls++;
      const graph: MockMicGraph = {
        sampleRate,
        handlers,
        closeCalls: 0,
        level: 0.42,
        emit(samples, chunkSize = 512) {
          for (let i = 0; i < samples.length; i += chunkSize) {
            handlers.onChunk(samples.slice(i, Math.min(samples.length, i + chunkSize)));
          }
        },
        getLevel() {
          return graph.level;
        },
        getWaveform(target) {
          target.fill(0.25);
          return true;
        },
        async close() {
          graph.closeCalls++;
        },
      };
      state.graphs.push(graph);
      return graph;
    },
  };
  return state;
}

/* ------------------------------------------------------------------ */
/* אותות סינתטיים דטרמיניסטיים                                          */
/* ------------------------------------------------------------------ */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** רעש לבן דטרמיניסטי ב-RMS נתון. */
export function noise(durationMs: number, sampleRate: number, rms: number, seed = 1): Float32Array {
  const n = Math.round((durationMs * sampleRate) / 1000);
  const out = new Float32Array(n);
  const rand = lcg(seed);
  const amp = rms * Math.sqrt(3); // RMS של התפלגות אחידה [-a,a] הוא a/√3
  for (let i = 0; i < n; i++) out[i] = (rand() * 2 - 1) * amp;
  return out;
}

/**
 * אות "דמוי דיבור": טון עם הברות של 200ms ורווחים קצרים של 50ms ברמת רעש הרקע
 * (כמו דיבור אמיתי, יש בו רגעים שקטים — חשוב למעקב אחרי רצפת הרעש).
 */
export function speechLike(durationMs: number, sampleRate: number, amplitude = 0.15, floorRms = 0.002): Float32Array {
  const n = Math.round((durationMs * sampleRate) / 1000);
  const out = new Float32Array(n);
  const bg = noise(durationMs, sampleRate, floorRms, 7);
  const syllable = Math.round(0.2 * sampleRate);
  const gap = Math.round(0.05 * sampleRate);
  for (let i = 0; i < n; i++) {
    const inGap = i % (syllable + gap) >= syllable;
    const tone = inGap ? 0 : amplitude * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
    out[i] = tone + (bg[i] ?? 0);
  }
  return out;
}

export function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* AudioContext להשמעה                                                  */
/* ------------------------------------------------------------------ */

export class MockAnalyser {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  connected: unknown[] = [];
  value = 0.5;
  connect(target: unknown): void {
    this.connected.push(target);
  }
  disconnect(): void {
    this.connected = [];
  }
  getFloatTimeDomainData(target: Float32Array): void {
    target.fill(this.value);
  }
}

export class MockBufferSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  started = 0;
  stopped = 0;
  disconnected = 0;
  connectedTo: unknown = null;
  connect(target: unknown): void {
    this.connectedTo = target;
  }
  disconnect(): void {
    this.disconnected++;
  }
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
  /** מדמה סוף השמעה טבעי. */
  finish(): void {
    this.onended?.();
  }
}

export class MockPlaybackContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  readonly destination = { kind: 'destination' };
  readonly analysers: MockAnalyser[] = [];
  readonly sources: MockBufferSource[] = [];
  readonly decoded: ArrayBuffer[] = [];
  suspendCalls = 0;
  resumeCalls = 0;
  /** אפשר להחליף כדי לדמות כשל פענוח או פענוח איטי. */
  decodeImpl: (data: ArrayBuffer) => Promise<{ duration: number }> = async () => ({ duration: 2 });

  createAnalyser(): MockAnalyser {
    const a = new MockAnalyser();
    this.analysers.push(a);
    return a;
  }
  createBufferSource(): MockBufferSource {
    const s = new MockBufferSource();
    this.sources.push(s);
    return s;
  }
  decodeAudioData(data: ArrayBuffer): Promise<{ duration: number }> {
    this.decoded.push(data);
    return this.decodeImpl(data);
  }
  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
  }
  async suspend(): Promise<void> {
    this.suspendCalls++;
    this.state = 'suspended';
  }
  async close(): Promise<void> {
    this.state = 'closed';
  }
}

/* ------------------------------------------------------------------ */
/* speechSynthesis                                                      */
/* ------------------------------------------------------------------ */

export interface MockVoice {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI: string;
  default: boolean;
}

export function mockVoice(name: string, lang: string, localService = true): MockVoice {
  return { name, lang, localService, voiceURI: name, default: false };
}

export class MockUtterance {
  voice: MockVoice | null = null;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public readonly text: string) {}
}

export class MockSynth {
  voices: MockVoice[] = [];
  spoken: MockUtterance[] = [];
  cancelCalls = 0;
  speaking = false;
  pending = false;
  private readonly listeners = new Set<() => void>();

  getVoices(): MockVoice[] {
    return this.voices;
  }
  speak(utterance: MockUtterance): void {
    this.spoken.push(utterance);
    this.speaking = true;
  }
  cancel(): void {
    this.cancelCalls++;
    this.speaking = false;
    const last = this.spoken[this.spoken.length - 1];
    last?.onerror?.({ error: 'canceled' });
  }
  addEventListener(type: string, listener: () => void): void {
    if (type === 'voiceschanged') this.listeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    if (type === 'voiceschanged') this.listeners.delete(listener);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
  /** מדמה טעינה מאוחרת של קולות. */
  loadVoices(voices: MockVoice[]): void {
    this.voices = voices;
    for (const l of [...this.listeners]) l();
  }
  /** מדמה תחילת הקראה בפועל (utterance.onstart). */
  startCurrent(): void {
    this.spoken[this.spoken.length - 1]?.onstart?.();
  }
  /** מדמה סיום הקראה. */
  finishCurrent(): void {
    this.speaking = false;
    this.spoken[this.spoken.length - 1]?.onend?.();
  }
}
