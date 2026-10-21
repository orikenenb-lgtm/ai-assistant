/**
 * לכידת מיקרופון רציפה ב-16kHz למילת ההפעלה (renderer בלבד).
 * האודיו נשאר בזיכרון ומעובד מקומית; שום דבר לא נשלח לרשת.
 *
 * עצירה באמצע הפתיחה: stop() יכול להגיע בזמן ש-start() עוד מחכה ל-getUserMedia / לטעינת ה-worklet.
 * במקרה כזה start() משחרר בעצמו את מה שכבר נפתח (tracks, AudioContext) וזורק AbortError —
 * כך לא נשאר מיקרופון פתוח "יתום" שממשיך להזרים אודיו אחרי שהגלאי נעצר.
 */

export type Mic16kFailure = 'track-ended' | 'context-closed' | 'context-interrupted';

export interface Mic16kEvents {
  /** המיקרופון הפסיק באמצע (התקן נותק, Windows סגר את ה-AudioContext וכו'). לא נקרא אחרי stop(). */
  onFailure?: (reason: Mic16kFailure) => void;
}

export interface Mic16k {
  start(deviceId?: string): Promise<void>;
  stop(): Promise<void>;
  readonly sampleRate: number;
}

/** השגיאה ש-start() זורק כשהוא נעצר באמצע (לא תקלה — מי שעצר כבר יודע). */
export function abortError(message = 'הפתיחה בוטלה.'): Error {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

export function createMic16k(onBlock: (samples: Float32Array) => void, events: Mic16kEvents = {}): Mic16k {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let stopped = false;
  let failed = false;

  function fail(reason: Mic16kFailure): void {
    if (stopped || failed) return;
    failed = true;
    events.onFailure?.(reason);
  }

  function stopTracks(s: MediaStream | null): void {
    for (const t of s?.getTracks() ?? []) {
      try {
        t.onended = null;
        t.stop();
      } catch {
        // כבר נעצר
      }
    }
  }

  async function closeContext(c: AudioContext | null): Promise<void> {
    if (!c) return;
    c.onstatechange = null;
    if (c.state !== 'closed') await c.close().catch(() => undefined);
  }

  return {
    get sampleRate() {
      return ctx?.sampleRate ?? 16000;
    },
    async start(deviceId) {
      stopped = false;
      failed = false;
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (stopped) {
        // stop() נקרא בזמן שהמיקרופון נפתח — משחררים מיד
        stopTracks(s);
        throw abortError();
      }
      stream = s;
      for (const t of s.getTracks()) t.onended = () => fail('track-ended');

      const c = new AudioContext({ sampleRate: 16000 });
      ctx = c;
      c.onstatechange = () => {
        // 'interrupted' — Chromium כשהתקן השמע נתפס/הושהה ע"י המערכת
        const state = c.state as string;
        if (state === 'closed') fail('context-closed');
        else if (state === 'interrupted') fail('context-interrupted');
      };
      try {
        await c.audioWorklet.addModule(new URL('./capture16k.worklet.js', import.meta.url));
      } catch (err) {
        stopTracks(s);
        stream = null;
        ctx = null;
        await closeContext(c);
        throw err;
      }
      if (stopped) {
        stopTracks(s);
        stream = null;
        ctx = null;
        await closeContext(c);
        throw abortError();
      }
      source = c.createMediaStreamSource(s);
      node = new AudioWorkletNode(c, 'jarvis-capture-16k', { numberOfInputs: 1, numberOfOutputs: 0 });
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!stopped) onBlock(e.data);
      };
      source.connect(node);
    },
    async stop() {
      stopped = true;
      try {
        source?.disconnect();
        node?.disconnect();
        if (node) node.port.onmessage = null;
      } catch {
        // כבר מנותק
      }
      stopTracks(stream);
      stream = null;
      source = null;
      node = null;
      const c = ctx;
      ctx = null;
      await closeContext(c);
    },
  };
}
