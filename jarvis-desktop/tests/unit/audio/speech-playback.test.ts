import { describe, expect, it } from 'vitest';
import {
  createSpeechPlaybackWith,
  DECODE_TIMEOUT_MS,
  PLAYBACK_IDLE_SUSPEND_MS,
  PLAYBACK_MESSAGES,
  PLAYBACK_WATCHDOG_EXTRA_MS,
} from '../../../src/renderer/audio/speech-playback';
import { deferred, flush, MockPlaybackContext, mockTimers } from './audio.mock';

function setup(decodeImpl?: MockPlaybackContext['decodeImpl']) {
  const timers = mockTimers();
  const contexts: MockPlaybackContext[] = [];
  const playback = createSpeechPlaybackWith({
    createContext: () => {
      const ctx = new MockPlaybackContext();
      if (decodeImpl) ctx.decodeImpl = decodeImpl;
      contexts.push(ctx);
      return ctx as unknown as AudioContext;
    },
    timers,
  });
  return { playback, timers, contexts };
}

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 1]);

describe('createSpeechPlaybackWith (mock)', () => {
  it("plays through an analyser and resolves 'ended' when the source finishes (mock)", async () => {
    const { playback, contexts } = setup();
    const playing = playback.play(MP3, 'audio/mpeg');
    expect(playback.playing).toBe(true);
    await flush();
    const ctx = contexts[0]!;
    const source = ctx.sources[0]!;
    expect(source.started).toBe(1);
    expect(source.connectedTo).toBe(ctx.analysers[0]);
    expect(ctx.analysers[0]!.connected).toContain(ctx.destination);
    expect(playback.getLevel()).toBeGreaterThan(0);
    const wave = new Float32Array(32);
    expect(playback.getWaveform(wave)).toBe(true);
    expect(wave[5]).toBe(0.5);

    source.finish();
    await expect(playing).resolves.toBe('ended');
    expect(playback.playing).toBe(false);
    expect(source.disconnected).toBe(1);
    expect(playback.getLevel()).toBe(0);
    expect(playback.getWaveform(wave)).toBe(false);
  });

  it('decodes a compact copy of the bytes and leaves the caller buffer intact (mock)', async () => {
    const { playback, contexts } = setup();
    // view על buffer גדול יותר — כמו שמגיע מ-IPC
    const big = new Uint8Array(64).fill(7);
    const view = big.subarray(10, 20);
    const playing = playback.play(view, 'audio/mpeg');
    await flush();
    const decoded = contexts[0]!.decoded[0]!;
    expect(decoded).not.toBe(big.buffer);
    expect(decoded.byteLength).toBe(10);
    expect(view.byteLength).toBe(10);
    expect(big.byteLength).toBe(64);
    playback.stop();
    await expect(playing).resolves.toBe('stopped');
  });

  it("stop() resolves 'stopped' immediately and stops the source (mock)", async () => {
    const { playback, contexts } = setup();
    const playing = playback.play(MP3, 'audio/mpeg');
    await flush();
    playback.stop();
    expect(playback.playing).toBe(false);
    await expect(playing).resolves.toBe('stopped');
    const source = contexts[0]!.sources[0]!;
    expect(source.stopped).toBe(1);
    expect(source.onended).toBeNull();
  });

  it("stop() during decoding resolves 'stopped' and never starts a source (mock)", async () => {
    const decoding = deferred<{ duration: number }>();
    const { playback, contexts } = setup(() => decoding.promise);
    const playing = playback.play(MP3, 'audio/mpeg');
    await flush();
    expect(playback.playing).toBe(true);
    playback.stop();
    await expect(playing).resolves.toBe('stopped');
    decoding.resolve({ duration: 1 });
    await flush();
    expect(contexts[0]!.sources).toHaveLength(0);
    expect(playback.playing).toBe(false);
  });

  it("a new play() replaces the current one, which resolves 'stopped' (mock)", async () => {
    const { playback, contexts } = setup();
    const first = playback.play(MP3, 'audio/mpeg');
    await flush();
    const second = playback.play(MP3, 'audio/mpeg');
    await expect(first).resolves.toBe('stopped');
    await flush();
    expect(contexts).toHaveLength(1); // אותו AudioContext
    contexts[0]!.sources[1]!.finish();
    await expect(second).resolves.toBe('ended');
  });

  it('rejects with a Hebrew error when decoding fails, and recovers for the next play (mock)', async () => {
    let failNext = true;
    const { playback, contexts } = setup(async () => {
      if (failNext) {
        failNext = false;
        throw new DOMException('bad data', 'EncodingError');
      }
      return { duration: 1 };
    });
    await expect(playback.play(MP3, 'audio/ogg')).rejects.toThrow(PLAYBACK_MESSAGES.decode('audio/ogg'));
    expect(playback.playing).toBe(false);
    const ok = playback.play(MP3, 'audio/ogg');
    await flush();
    contexts[0]!.sources[0]!.finish();
    await expect(ok).resolves.toBe('ended');
  });

  it('rejects instead of hanging when decoding never finishes (mock)', async () => {
    const { playback, timers } = setup(() => new Promise(() => undefined));
    const playing = playback.play(MP3, 'audio/mpeg');
    await flush();
    expect(playback.playing).toBe(true);
    timers.advance(DECODE_TIMEOUT_MS + 1);
    await expect(playing).rejects.toThrow(PLAYBACK_MESSAGES.decode('audio/mpeg'));
    expect(playback.playing).toBe(false);
  });

  it('rejects empty audio (mock)', async () => {
    const { playback } = setup();
    await expect(playback.play(new Uint8Array(0), 'audio/mpeg')).rejects.toThrow(PLAYBACK_MESSAGES.empty);
    expect(playback.playing).toBe(false);
  });

  it('rejects when Web Audio is unavailable (mock)', async () => {
    const playback = createSpeechPlaybackWith({
      createContext: () => {
        throw new Error('no AudioContext');
      },
      timers: mockTimers(),
    });
    await expect(playback.play(MP3, 'audio/mpeg')).rejects.toThrow(PLAYBACK_MESSAGES.unsupported);
    expect(playback.playing).toBe(false);
  });

  it("resolves via the watchdog if 'ended' never arrives (output device lost) (mock)", async () => {
    const { playback, contexts, timers } = setup();
    const playing = playback.play(MP3, 'audio/mpeg');
    await flush();
    timers.advance(2_000 + PLAYBACK_WATCHDOG_EXTRA_MS - 1);
    expect(playback.playing).toBe(true);
    timers.advance(2);
    await expect(playing).resolves.toBe('ended');
    expect(contexts[0]!.sources[0]!.stopped).toBe(1);
  });

  it('suspends the context after idling and resumes it for the next playback (mock)', async () => {
    const { playback, contexts, timers } = setup();
    const first = playback.play(MP3, 'audio/mpeg');
    await flush();
    contexts[0]!.sources[0]!.finish();
    await first;
    timers.advance(PLAYBACK_IDLE_SUSPEND_MS + 1);
    await flush();
    expect(contexts[0]!.state).toBe('suspended');
    const second = playback.play(MP3, 'audio/mpeg');
    await flush();
    expect(contexts[0]!.resumeCalls).toBe(1);
    expect(contexts[0]!.state).toBe('running');
    contexts[0]!.sources[1]!.finish();
    await expect(second).resolves.toBe('ended');
  });

  it('does not suspend while another playback started before the idle timer fired (mock)', async () => {
    const { playback, contexts, timers } = setup();
    const first = playback.play(MP3, 'audio/mpeg');
    await flush();
    contexts[0]!.sources[0]!.finish();
    await first;
    timers.advance(PLAYBACK_IDLE_SUSPEND_MS - 100);
    const second = playback.play(MP3, 'audio/mpeg');
    await flush();
    timers.advance(1_000);
    expect(contexts[0]!.suspendCalls).toBe(0);
    playback.stop();
    await expect(second).resolves.toBe('stopped');
  });
});

describe('createSpeechPlaybackWith — started signal (mock)', () => {
  it('onStarted fires right after source.start(), after decoding (mock)', async () => {
    let release!: () => void;
    const { playback, contexts } = setup(() => new Promise((r) => (release = () => r({ duration: 1 }))));
    let started = 0;
    const playing = playback.play(MP3, 'audio/mpeg', { onStarted: () => started++ });
    await flush();
    expect(started).toBe(0);
    release();
    await flush();
    expect(contexts[0]!.sources[0]!.started).toBe(1);
    expect(started).toBe(1);
    contexts[0]!.sources[0]!.finish();
    await expect(playing).resolves.toBe('ended');
  });

  it('no onStarted when stopped during decoding or when decoding fails (mock)', async () => {
    let release!: () => void;
    const a = setup(() => new Promise((r) => (release = () => r({ duration: 1 }))));
    let started = 0;
    const playing = a.playback.play(MP3, 'audio/mpeg', { onStarted: () => started++ });
    await flush();
    a.playback.stop();
    release();
    await flush();
    await expect(playing).resolves.toBe('stopped');
    expect(started).toBe(0);

    const b = setup(() => Promise.reject(new Error('bad data')));
    await expect(b.playback.play(MP3, 'audio/mpeg', { onStarted: () => started++ })).rejects.toThrow();
    expect(started).toBe(0);
  });
});
