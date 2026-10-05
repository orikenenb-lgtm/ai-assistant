import { describe, expect, it, vi } from 'vitest';
import {
  buildMicConstraints,
  createMicCaptureWith,
  OPEN_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  TRAILING_SILENCE_KEEP_MS,
  type MicCaptureDeps,
  type MicGraph,
  type MicGraphHandlers,
} from '../../../src/renderer/audio/mic-capture';
import { MIC_MESSAGES } from '../../../src/renderer/audio/mic-errors';
import { MicError, type CaptureResult } from '../../../src/renderer/audio/types';
import {
  concat,
  deferred,
  flush,
  mockMicGraphFactory,
  mockStream,
  mockTimers,
  noise,
  speechLike,
  type MockTimers,
  type MockTrack,
} from './audio.mock';

const RATE = 16_000;
const OPTIONS = { silenceTimeoutMs: 1_000, maxUtteranceSec: 15 };

function wavInfo(wav: Uint8Array): { sampleRate: number; dataBytes: number; channels: number; bits: number } {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  return {
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bits: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  };
}

function setup(options: { sampleRate?: number; trackCount?: number } = {}) {
  const timers = mockTimers();
  /** כל ה-tracks מכל הזרמים שנפתחו (כמו בדפדפן: כל getUserMedia מחזיר זרם חדש). */
  const tracks: MockTrack[] = [];
  const graphs = mockMicGraphFactory(options.sampleRate ?? RATE);
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => {
    const opened = mockStream(options.trackCount ?? 1);
    tracks.push(...opened.tracks);
    return opened.stream;
  });
  const deps: MicCaptureDeps = { getUserMedia, openGraph: graphs.openGraph, timers };
  const mic = createMicCaptureWith(deps);
  return { mic, timers, tracks, graphs, getUserMedia, deps };
}

function expectReleased(tracks: MockTrack[], graphCloseCalls: number, timers: MockTimers): void {
  for (const t of tracks) {
    expect(t.stopCalls).toBeGreaterThanOrEqual(1);
    expect(t.listenerCount('ended')).toBe(0);
  }
  expect(graphCloseCalls).toBe(1);
  expect(timers.pendingCount).toBe(0);
}

describe('createMicCaptureWith (mock)', () => {
  it('requests mono audio with echo cancellation, noise suppression and AGC (mock)', async () => {
    const { mic, getUserMedia } = setup();
    await mic.start(OPTIONS);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    mic.cancel();
  });

  it('uses an exact deviceId only for a real device id (mock)', () => {
    expect((buildMicConstraints('abc123').audio as MediaTrackConstraints).deviceId).toEqual({ exact: 'abc123' });
    expect((buildMicConstraints('').audio as MediaTrackConstraints).deviceId).toBeUndefined();
    expect((buildMicConstraints('default').audio as MediaTrackConstraints).deviceId).toBeUndefined();
    expect((buildMicConstraints(undefined).audio as MediaTrackConstraints).deviceId).toBeUndefined();
  });

  it('speech then silence -> reason silence, 16 kHz WAV trimmed after speech, mic released (mock)', async () => {
    const { mic, timers, tracks, graphs } = setup();
    expect(mic.done).toBeNull();
    await mic.start(OPTIONS);
    expect(mic.active).toBe(true);
    const done = mic.done;
    expect(done).not.toBeNull();

    const graph = graphs.graphs[0]!;
    graph.emit(concat(noise(500, RATE, 0.002), speechLike(1_500, RATE), noise(3_000, RATE, 0.002, 3)));
    const result = (await done) as CaptureResult;

    expect(result.reason).toBe('silence');
    expect(result.speechDetected).toBe(true);
    const info = wavInfo(result.wav);
    expect(info).toMatchObject({ sampleRate: 16_000, channels: 1, bits: 16 });
    expect(result.wav.byteLength).toBe(44 + info.dataBytes);
    expect(info.dataBytes / 2).toBe(Math.round((result.durationMs * 16_000) / 1000));
    // הדיבור מסתיים ב-2000ms; נשאר זנב של 400ms בלבד מתוך שנייה של שקט
    expect(result.durationMs).toBeGreaterThanOrEqual(2_000 + TRAILING_SILENCE_KEEP_MS - 60);
    expect(result.durationMs).toBeLessThanOrEqual(2_000 + TRAILING_SILENCE_KEEP_MS + 20);
    expect(mic.active).toBe(false);
    expectReleased(tracks, graph.closeCalls, timers);
  });

  it('no speech -> ends after 6 s with speechDetected=false (mock)', async () => {
    const { mic, tracks, graphs, timers } = setup();
    await mic.start(OPTIONS);
    graphs.graphs[0]!.emit(noise(7_000, RATE, 0.002));
    const result = (await mic.done) as CaptureResult;
    expect(result).toMatchObject({ reason: 'silence', speechDetected: false, durationMs: 6_000 });
    expectReleased(tracks, graphs.graphs[0]!.closeCalls, timers);
  });

  it('stops at maxUtteranceSec (mock)', async () => {
    const { mic, graphs } = setup();
    await mic.start({ silenceTimeoutMs: 1_000, maxUtteranceSec: 3 });
    graphs.graphs[0]!.emit(concat(noise(300, RATE, 0.002), speechLike(6_000, RATE)));
    const result = (await mic.done) as CaptureResult;
    expect(result).toMatchObject({ reason: 'max-duration', speechDetected: true, durationMs: 3_000 });
    expect(wavInfo(result.wav).dataBytes).toBe(3 * 16_000 * 2);
  });

  it('caps maxUtteranceSec at 60 s so the WAV stays within the transcription limits (mock)', async () => {
    const { mic, graphs } = setup();
    await mic.start({ silenceTimeoutMs: 1_000, maxUtteranceSec: 600 });
    const graph = graphs.graphs[0]!;
    for (let i = 0; i < 62 && mic.active; i++) graph.emit(speechLike(1_000, RATE));
    const result = (await mic.done) as CaptureResult;
    expect(result.reason).toBe('max-duration');
    expect(result.durationMs).toBe(60_000);
  });

  it('stop() -> reason manual with everything recorded so far (mock)', async () => {
    const { mic, tracks, graphs, timers } = setup();
    await mic.start(OPTIONS);
    graphs.graphs[0]!.emit(concat(noise(200, RATE, 0.002), speechLike(800, RATE)));
    mic.stop();
    expect(mic.active).toBe(false);
    const result = (await mic.done) as CaptureResult;
    expect(result.reason).toBe('manual');
    expect(result.speechDetected).toBe(true);
    expect(result.durationMs).toBe(1_000);
    expectReleased(tracks, graphs.graphs[0]!.closeCalls, timers);
    // מקטעים מאוחרים אחרי הסיום נזרקים
    graphs.graphs[0]!.emit(speechLike(500, RATE));
    expect(mic.getLevel()).toBe(0);
  });

  it('cancel() -> empty wav, reason cancelled, mic released (mock)', async () => {
    const { mic, tracks, graphs, timers } = setup();
    await mic.start(OPTIONS);
    graphs.graphs[0]!.emit(speechLike(1_000, RATE));
    mic.cancel();
    const result = (await mic.done) as CaptureResult;
    expect(result).toEqual({ reason: 'cancelled', wav: new Uint8Array(0), durationMs: 0, speechDetected: false });
    expectReleased(tracks, graphs.graphs[0]!.closeCalls, timers);
  });

  it('resamples a 48 kHz graph to 16 kHz (mock)', async () => {
    const { mic, graphs } = setup({ sampleRate: 48_000 });
    await mic.start(OPTIONS);
    graphs.graphs[0]!.emit(concat(noise(200, 48_000, 0.002), speechLike(800, 48_000)), 1_536);
    mic.stop();
    const result = (await mic.done) as CaptureResult;
    expect(wavInfo(result.wav).sampleRate).toBe(16_000);
    expect(wavInfo(result.wav).dataBytes).toBe(16_000 * 2);
    expect(result.durationMs).toBe(1_000);
    expect(result.speechDetected).toBe(true);
  });

  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'no-device'],
    ['OverconstrainedError', 'no-device'],
    ['NotReadableError', 'device-busy'],
    ['AbortError', 'device-busy'],
    ['WeirdError', 'unknown'],
  ] as const)('maps getUserMedia %s to MicError %s (mock)', async (name, kind) => {
    const { mic, deps, graphs } = setup();
    deps.getUserMedia = async () => {
      throw new DOMException('denied', name);
    };
    const fresh = createMicCaptureWith(deps);
    const error = await fresh.start(OPTIONS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MicError);
    expect((error as MicError).kind).toBe(kind);
    expect((error as MicError).message).toMatch(/[֐-׿]/); // הודעה בעברית
    expect(fresh.active).toBe(false);
    expect(fresh.done).toBeNull();
    expect(graphs.calls).toBe(0);
    void mic;
  });

  it('explains that the selected device is missing when an exact deviceId fails (mock)', async () => {
    const { deps } = setup();
    deps.getUserMedia = async () => {
      throw new DOMException('no such device', 'OverconstrainedError');
    };
    const error = await createMicCaptureWith(deps)
      .start({ ...OPTIONS, deviceId: 'usb-mic-1' })
      .catch((e: unknown) => e);
    expect((error as MicError).kind).toBe('no-device');
    expect((error as MicError).message).toBe(MIC_MESSAGES.selectedDeviceMissing);
  });

  it('reports unsupported when getUserMedia is missing (mock)', async () => {
    const { deps } = setup();
    const error = await createMicCaptureWith({ ...deps, getUserMedia: undefined })
      .start(OPTIONS)
      .catch((e: unknown) => e);
    expect((error as MicError).kind).toBe('unsupported');
  });

  it('fails with no-device and releases the stream when it has no audio tracks (mock)', async () => {
    const { deps, graphs } = setup();
    const { stream, tracks } = mockStream(1);
    const empty = { getTracks: () => tracks, getAudioTracks: () => [] } as unknown as MediaStream;
    void stream;
    const error = await createMicCaptureWith({ ...deps, getUserMedia: async () => empty })
      .start(OPTIONS)
      .catch((e: unknown) => e);
    expect((error as MicError).kind).toBe('no-device');
    expect(tracks[0]!.stopCalls).toBe(1);
    expect(graphs.calls).toBe(0);
  });

  it('stops the tracks when the audio graph cannot be built (mock)', async () => {
    const { deps, tracks } = setup();
    const mic = createMicCaptureWith({
      ...deps,
      openGraph: async () => {
        throw new Error('addModule failed');
      },
    });
    const error = await mic.start(OPTIONS).catch((e: unknown) => e);
    expect((error as MicError).kind).toBe('unknown');
    expect((error as MicError).message).toBe(MIC_MESSAGES.audioEngine);
    expect(tracks[0]!.stopCalls).toBe(1);
    expect(mic.active).toBe(false);
    // אפשר לנסות שוב אחרי כישלון
    await expect(mic.start(OPTIONS)).rejects.toBeInstanceOf(MicError);
  });

  it('cancel() while the mic is still opening releases it as soon as it opens (mock)', async () => {
    const { deps, tracks, graphs, timers } = setup();
    const { stream } = { stream: (await deps.getUserMedia!({})) as MediaStream };
    const pending = deferred<MediaStream>();
    const mic = createMicCaptureWith({ ...deps, getUserMedia: () => pending.promise });
    const starting = mic.start(OPTIONS);
    mic.cancel();
    pending.resolve(stream);
    await starting;
    const result = (await mic.done) as CaptureResult;
    expect(result.reason).toBe('cancelled');
    expect(result.wav.byteLength).toBe(0);
    expect(tracks[0]!.stopCalls).toBe(1);
    expect(graphs.calls).toBe(0);
    expect(mic.active).toBe(false);
    expect(timers.pendingCount).toBe(0);
  });

  it('stop() while the graph is being built closes it and resolves done as manual (mock)', async () => {
    const { deps, tracks, timers } = setup();
    const pendingGraph = deferred<MicGraph>();
    const graphFactory = mockMicGraphFactory(RATE);
    let handlers: MicGraphHandlers | null = null;
    const mic = createMicCaptureWith({
      ...deps,
      openGraph: (stream, h) => {
        handlers = h;
        return graphFactory.openGraph(stream, h).then(async (g) => {
          await pendingGraph.promise;
          return g;
        });
      },
    });
    const starting = mic.start(OPTIONS);
    await flush();
    expect(handlers).not.toBeNull();
    mic.stop();
    pendingGraph.resolve(null as unknown as MicGraph);
    await starting;
    const result = (await mic.done) as CaptureResult;
    expect(result.reason).toBe('manual');
    expect(result.speechDetected).toBe(false);
    expect(graphFactory.graphs[0]!.closeCalls).toBe(1);
    expect(tracks[0]!.stopCalls).toBe(1);
    expect(timers.pendingCount).toBe(0);
  });

  it('keeps audio that arrives before start() resolves (mock)', async () => {
    const { deps } = setup();
    const factory = mockMicGraphFactory(RATE);
    const mic = createMicCaptureWith({
      ...deps,
      openGraph: async (stream, handlers) => {
        const graph = await factory.openGraph(stream, handlers);
        handlers.onChunk(speechLike(500, RATE)); // ה-worklet כבר שלח לפני שה-start הסתיים
        return graph;
      },
    });
    await mic.start(OPTIONS);
    mic.stop();
    const result = (await mic.done) as CaptureResult;
    expect(result.durationMs).toBe(500);
  });

  it('a device unplugged mid-capture ends with reason error and keeps the audio (mock)', async () => {
    const { mic, tracks, graphs, timers } = setup();
    await mic.start(OPTIONS);
    graphs.graphs[0]!.emit(concat(noise(200, RATE, 0.002), speechLike(800, RATE)));
    tracks[0]!.unplug();
    const result = (await mic.done) as CaptureResult;
    expect(result.reason).toBe('error');
    expect(result.durationMs).toBe(1_000);
    expect(result.speechDetected).toBe(true);
    expectReleased(tracks, graphs.graphs[0]!.closeCalls, timers);
  });

  it('a stalled audio engine ends with reason error (mock)', async () => {
    const { mic, tracks, graphs, timers } = setup();
    await mic.start(OPTIONS);
    graphs.graphs[0]!.emit(noise(300, RATE, 0.002));
    timers.advance(STALL_TIMEOUT_MS - 500);
    expect(mic.active).toBe(true);
    timers.advance(1_000);
    const result = (await mic.done) as CaptureResult;
    expect(result.reason).toBe('error');
    expectReleased(tracks, graphs.graphs[0]!.closeCalls, timers);
  });

  it('a worklet processor error ends with reason error (mock)', async () => {
    const { mic, graphs } = setup();
    await mic.start(OPTIONS);
    graphs.graphs[0]!.handlers.onFault(new Error('processorerror'));
    expect((await mic.done)?.reason).toBe('error');
  });

  it('times out a getUserMedia that never answers and releases a late stream (mock)', async () => {
    const { deps, timers, tracks } = setup();
    const pending = deferred<MediaStream>();
    const mic = createMicCaptureWith({ ...deps, getUserMedia: () => pending.promise });
    const starting = mic.start(OPTIONS).catch((e: unknown) => e);
    await flush();
    timers.advance(OPEN_TIMEOUT_MS + 1);
    const error = await starting;
    expect((error as MicError).kind).toBe('device-busy');
    const { stream } = { stream: (await deps.getUserMedia!({})) as MediaStream };
    pending.resolve(stream);
    await flush();
    expect(tracks[0]!.stopCalls).toBe(1);
    expect(mic.active).toBe(false);
  });

  it('rejects a second start() while recording, and can record again after it ends (mock)', async () => {
    const { mic, graphs } = setup();
    await mic.start(OPTIONS);
    await expect(mic.start(OPTIONS)).rejects.toMatchObject({ kind: 'unknown', message: MIC_MESSAGES.alreadyActive });
    expect(mic.active).toBe(true);
    mic.cancel();
    await mic.done;
    await mic.start(OPTIONS);
    expect(mic.active).toBe(true);
    expect(graphs.graphs).toHaveLength(2);
    graphs.graphs[1]!.emit(speechLike(300, RATE));
    mic.stop();
    expect((await mic.done)?.durationMs).toBe(300);
  });

  it('exposes level and waveform only while recording, and reports onLevel 0..1 (mock)', async () => {
    const { mic, graphs } = setup();
    const levels: number[] = [];
    const target = new Float32Array(64);
    expect(mic.getLevel()).toBe(0);
    expect(mic.getWaveform(target)).toBe(false);
    await mic.start({
      ...OPTIONS,
      onLevel: (level) => {
        levels.push(level);
        if (levels.length === 2) throw new Error('UI bug'); // לא אמור לעצור את ההקלטה
      },
    });
    expect(mic.getLevel()).toBe(0.42);
    expect(mic.getWaveform(target)).toBe(true);
    expect(target[10]).toBe(0.25);
    graphs.graphs[0]!.emit(concat(noise(200, RATE, 0.002), speechLike(400, RATE)));
    expect(mic.active).toBe(true);
    expect(levels.length).toBeGreaterThan(5);
    expect(levels.every((l) => l >= 0 && l <= 1)).toBe(true);
    expect(Math.max(...levels)).toBeGreaterThan(0.5);
    mic.cancel();
    await mic.done;
    expect(mic.getLevel()).toBe(0);
    expect(mic.getWaveform(target)).toBe(false);
  });

  it('stop() and cancel() without a recording are harmless no-ops (mock)', () => {
    const { mic } = setup();
    expect(() => {
      mic.stop();
      mic.cancel();
    }).not.toThrow();
    expect(mic.done).toBeNull();
  });
});
