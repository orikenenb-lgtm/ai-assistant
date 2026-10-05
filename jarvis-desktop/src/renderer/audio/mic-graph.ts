import { analyserLevelSource } from './level';
import type { MicCaptureDeps, MicGraph, MicGraphHandlers } from './mic-capture';
import { MIC_MESSAGES } from './mic-errors';
import { browserTimers, settleWithin } from './timers';
import { MicError } from './types';
import { TARGET_SAMPLE_RATE } from './wav';

/**
 * גרף ה-Web Audio של המיקרופון (דפדפן בלבד):
 *
 *   MediaStreamSource ─┬─> AnalyserNode            (getLevel / getWaveform — אות אמיתי)
 *                      └─> AudioWorkletNode ─> Gain(0) ─> destination
 *
 * ה-Gain(0) מבטיח שהדפדפן "מושך" את ה-worklet (צמתים שלא מחוברים ליעד לא תמיד מעובדים),
 * בלי להשמיע את המיקרופון ברמקולים.
 * ScriptProcessorNode משמש גיבוי רק כש-audioWorklet לא קיים בסביבה.
 */

const PROCESSOR_NAME = 'jarvis-pcm-capture';
/** גודל מקטע שה-worklet שולח (~32ms) — איזון בין תקורת הודעות לתגובתיות. */
const BATCH_MS = 32;
const RESUME_TIMEOUT_MS = 3_000;
const ADD_MODULE_TIMEOUT_MS = 8_000;
const ANALYSER_FFT_SIZE = 2048;

/**
 * כתובת מודול ה-worklet. Vite מזהה את התבנית new URL('./x', import.meta.url), מעתיק את הקובץ
 * ל-dist/renderer/assets עם hash, ומחליף את הנתיב — כך הוא נטען מאותו מקור ('self') תחת ה-CSP.
 * (assetsInlineLimit: 0 מבטיח שלא יהפוך ל-data: URL, שה-CSP היה חוסם.)
 */
function workletModuleUrl(): string {
  return new URL('./pcm-capture.worklet.js', import.meta.url).href;
}

/** קורא מצב בלי ש-TypeScript "יזכור" צמצום טיפוס מלפני await. */
function stateOf(ctx: BaseAudioContext): string {
  return ctx.state;
}

function createCaptureContext(): AudioContext {
  const Ctor = globalThis.AudioContext;
  if (typeof Ctor !== 'function') throw new MicError('unsupported', MIC_MESSAGES.unsupported);
  try {
    // Chromium ממיר את המיקרופון ל-16kHz בעצמו (resampler איכותי) — הדרך המועדפת
    return new Ctor({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: 'interactive' });
  } catch {
    // קצב 16kHz לא נתמך — עובדים בקצב המקורי, ו-resampleTo16k ממיר בסוף ההקלטה
    return new Ctor({ latencyHint: 'interactive' });
  }
}

/** חזקת 2 בטווח 256..16384 שקרובה ל-~32ms (דרישה של createScriptProcessor). */
function scriptProcessorBufferSize(sampleRate: number): number {
  const wanted = (sampleRate * BATCH_MS) / 1000;
  let size = 256;
  while (size < wanted && size < 16384) size *= 2;
  return size;
}

export async function openBrowserMicGraph(stream: MediaStream, handlers: MicGraphHandlers): Promise<MicGraph> {
  const ctx = createCaptureContext();
  const nodes: AudioNode[] = [];
  let workletNode: AudioWorkletNode | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let closed = false;

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    if (workletNode) {
      const port = workletNode.port;
      port.onmessage = null;
      workletNode.onprocessorerror = null;
      try {
        port.postMessage({ type: 'stop' });
      } catch {
        // הפורט כבר סגור
      }
      port.close();
    }
    if (scriptNode) scriptNode.onaudioprocess = null;
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // צומת שכבר נותק
      }
    }
    if (stateOf(ctx) !== 'closed') {
      try {
        await ctx.close();
      } catch {
        // סגירה כפולה או הקשר שכבר נהרס — לא משנה, המשאבים משוחררים
      }
    }
  }

  try {
    const source = ctx.createMediaStreamSource(stream);
    nodes.push(source);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    nodes.push(analyser);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    nodes.push(sink);

    let capture: AudioNode;
    if (ctx.audioWorklet && typeof globalThis.AudioWorkletNode === 'function') {
      // הגבלת זמן קצרה מזו של MicCapture, כדי שגם במקרה תקוע ה-AudioContext ייסגר כאן
      const loaded = await settleWithin(ctx.audioWorklet.addModule(workletModuleUrl()), ADD_MODULE_TIMEOUT_MS, browserTimers);
      if (loaded.status === 'timeout') throw new MicError('unknown', MIC_MESSAGES.audioEngineTimeout);
      if (loaded.status === 'failed') throw loaded.error;
      const batchSize = Math.max(128, Math.round((ctx.sampleRate * BATCH_MS) / 1000 / 128) * 128);
      const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers', // סטריאו -> מונו בממוצע
        processorOptions: { batchSize },
      });
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data instanceof Float32Array) handlers.onChunk(event.data);
      };
      node.onprocessorerror = (event) => handlers.onFault(event);
      workletNode = node;
      capture = node;
    } else {
      // גיבוי בלבד: ScriptProcessorNode מיושן ורץ על ה-main thread, אבל עדיף על חוסר הקלטה
      const node = ctx.createScriptProcessor(scriptProcessorBufferSize(ctx.sampleRate), 1, 1);
      node.onaudioprocess = (event) => {
        // הדפדפן ממחזר את ה-buffer — חייבים להעתיק
        handlers.onChunk(event.inputBuffer.getChannelData(0).slice());
      };
      scriptNode = node;
      capture = node;
    }
    nodes.push(capture);

    source.connect(analyser);
    source.connect(capture);
    capture.connect(sink);
    sink.connect(ctx.destination);

    if (stateOf(ctx) !== 'running') {
      const resumed = await settleWithin(ctx.resume(), RESUME_TIMEOUT_MS, browserTimers);
      if (resumed.status !== 'ok' || stateOf(ctx) !== 'running') {
        throw new MicError('unknown', MIC_MESSAGES.audioEngineTimeout);
      }
    }

    const level = analyserLevelSource(analyser);
    return {
      sampleRate: ctx.sampleRate,
      getLevel: () => (closed ? 0 : level.getLevel()),
      getWaveform: (target: Float32Array) => (closed ? false : level.getWaveform(target)),
      close,
    };
  } catch (error) {
    await close();
    if (error instanceof MicError) throw error;
    console.error('[audio] פתיחת גרף המיקרופון נכשלה', error);
    throw new MicError('unknown', MIC_MESSAGES.audioEngine);
  }
}

/** התלויות האמיתיות של MicCapture בדפדפן. */
export function browserMicCaptureDeps(): MicCaptureDeps {
  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  return {
    getUserMedia:
      mediaDevices && typeof mediaDevices.getUserMedia === 'function'
        ? (constraints) => mediaDevices.getUserMedia(constraints)
        : undefined,
    openGraph: openBrowserMicGraph,
    timers: browserTimers,
  };
}
