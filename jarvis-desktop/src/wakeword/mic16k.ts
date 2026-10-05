/**
 * לכידת מיקרופון רציפה ב-16kHz למילת ההפעלה (renderer בלבד).
 * האודיו נשאר בזיכרון ומעובד מקומית; שום דבר לא נשלח לרשת.
 */

export interface Mic16k {
  start(deviceId?: string): Promise<void>;
  stop(): Promise<void>;
  readonly sampleRate: number;
}

export function createMic16k(onBlock: (samples: Float32Array) => void): Mic16k {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;

  return {
    get sampleRate() {
      return ctx?.sampleRate ?? 16000;
    },
    async start(deviceId) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule(new URL('./capture16k.worklet.js', import.meta.url));
      source = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'jarvis-capture-16k', { numberOfInputs: 1, numberOfOutputs: 0 });
      node.port.onmessage = (e: MessageEvent<Float32Array>) => onBlock(e.data);
      source.connect(node);
    },
    async stop() {
      try {
        source?.disconnect();
        node?.disconnect();
        if (node) node.port.onmessage = null;
      } catch {
        // כבר מנותק
      }
      for (const t of stream?.getTracks() ?? []) t.stop();
      stream = null;
      source = null;
      node = null;
      if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => undefined);
      ctx = null;
    },
  };
}
