import { describe, expect, it } from 'vitest';
import * as audio from '../../../src/renderer/audio/index';
import { NO_MIC_ENV_MESSAGE } from '../../../src/wakeword/detectors';

describe('createWakeWordDetector', () => {
  it.each(['openwakeword', 'porcupine'] as const)(
    '%s: real engine is wired; without microphone APIs (node) start() fails clearly in Hebrew and state becomes error',
    async (engine) => {
      const detector = audio.createWakeWordDetector(engine);
      expect(detector.engine).toBe(engine);
      expect(detector.state).toBe('stopped');
      expect(detector.lastError).toBeNull();

      await expect(detector.start({ sensitivity: 0.5, onDetected: () => undefined })).rejects.toThrow(NO_MIC_ENV_MESSAGE);
      expect(detector.state).toBe('error');
      expect(detector.lastError).toBe(NO_MIC_ENV_MESSAGE);

      await detector.stop();
      expect(detector.state).toBe('stopped');
    },
  );
});

describe('audio entry point', () => {
  it('keeps exactly the contract exports', () => {
    expect(Object.keys(audio).sort()).toEqual(
      [
        'MicError',
        'createMicCapture',
        'createSpeechPlayback',
        'createSystemSpeaker',
        'createWakeWordDetector',
        'isLikelyEcho',
      ].sort(),
    );
  });

  it('factories do not touch browser APIs until used (safe to import in node)', () => {
    expect(typeof audio.createMicCapture).toBe('function');
    const mic = audio.createMicCapture();
    expect(mic.active).toBe(false);
    expect(mic.done).toBeNull();
    expect(mic.getLevel()).toBe(0);
  });

  it('createMicCapture() reports unsupported when there is no mediaDevices (node)', async () => {
    const mic = audio.createMicCapture();
    const error = await mic.start({ silenceTimeoutMs: 1_000, maxUtteranceSec: 10 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(audio.MicError);
    expect((error as audio.MicError).kind).toBe('unsupported');
  });

  it("createSystemSpeaker() answers 'no-voice' without speechSynthesis (node)", async () => {
    await expect(audio.createSystemSpeaker().speak('שלום', { rate: 1 })).resolves.toBe('no-voice');
  });
});
