import { describe, expect, it, vi } from 'vitest';
import { createPorcupineService, mapPorcupineError, unpackedPath } from '../../../src/main/wakeword/porcupine-service';
import { silentLogger } from '../../../src/main/app/logger';

/** MOCK של @picovoice/porcupine-node — הספרייה האמיתית דורשת AccessKey ואימות אונליין. */
function mockModule(opts: { throwOnInit?: Error; detectAtCall?: number } = {}) {
  const calls: { init: unknown[] | null; frames: number; released: boolean } = { init: null, frames: 0, released: false };
  class Porcupine {
    readonly frameLength = 512;
    readonly sampleRate = 16000;
    constructor(...args: unknown[]) {
      if (opts.throwOnInit) throw opts.throwOnInit;
      calls.init = args;
    }
    process(frame: Int16Array): number {
      expect(frame.length).toBe(512);
      calls.frames++;
      return opts.detectAtCall === calls.frames ? 0 : -1;
    }
    release() {
      calls.released = true;
    }
  }
  return {
    calls,
    module: {
      Porcupine,
      getBuiltinKeywordPath: (k: string) => `/app/resources/app.asar/node_modules/@picovoice/porcupine-node/resources/keyword_files/windows/${k}_windows.ppn`,
    },
  };
}

class PorcupineInvalidArgumentError extends Error {}
class PorcupineActivationLimitReachedError extends Error {}

describe('Porcupine wake word service (mock native module)', () => {
  it('refuses to start without a Picovoice AccessKey and explains how to get one', () => {
    const load = vi.fn();
    const svc = createPorcupineService({ getAccessKey: () => null, logger: silentLogger, loadModule: load });
    const res = svc.start({ sensitivity: 0.5 });
    expect(res).toMatchObject({ ok: false, code: 'MISSING_API_KEY' });
    expect(load).not.toHaveBeenCalled();
  });

  it('starts with the built-in "jarvis" keyword from the unpacked folder and the clamped sensitivity', () => {
    const m = mockModule();
    const svc = createPorcupineService({ getAccessKey: () => 'pv-key-123', logger: silentLogger, loadModule: () => m.module });
    expect(svc.start({ sensitivity: 0.99 })).toEqual({ ok: true, frameLength: 512, sampleRate: 16000 });
    const [key, keywords, sens] = m.calls.init as [string, string[], number[]];
    expect(key).toBe('pv-key-123');
    expect(keywords[0]).toContain('app.asar.unpacked');
    expect(keywords[0]).toMatch(/jarvis_windows\.ppn$/);
    expect(sens).toEqual([0.95]);
    expect(svc.running).toBe(true);
  });

  it('buffers arbitrary chunk sizes into 512-sample frames and reports detection', () => {
    const m = mockModule({ detectAtCall: 3 });
    const svc = createPorcupineService({ getAccessKey: () => 'k', logger: silentLogger, loadModule: () => m.module });
    svc.start({ sensitivity: 0.5 });
    expect(svc.process(new Int16Array(700))).toBe(false); // 700 → פריים 1, נשארו 188
    expect(svc.process(new Int16Array(700))).toBe(false); // 888 → פריים 2, נשארו 376
    expect(m.calls.frames).toBe(2);
    expect(svc.process(new Int16Array(200))).toBe(true); // 576 → פריים 3 = זיהוי
    expect(m.calls.frames).toBe(3);
    svc.stop();
    expect(m.calls.released).toBe(true);
    expect(svc.process(new Int16Array(1024))).toBe(false);
  });

  it('maps native errors to clear Hebrew messages', () => {
    expect(mapPorcupineError(new PorcupineInvalidArgumentError('x'))).toMatchObject({ code: 'INVALID_API_KEY' });
    expect(mapPorcupineError(new PorcupineActivationLimitReachedError('x'))).toMatchObject({ code: 'RATE_LIMITED' });
    expect(mapPorcupineError(new Error('x')).message_he).toMatch(/[\u0590-\u05FF]/);
    const m = mockModule({ throwOnInit: new PorcupineInvalidArgumentError('bad key') });
    const svc = createPorcupineService({ getAccessKey: () => 'k', logger: silentLogger, loadModule: () => m.module });
    expect(svc.start({ sensitivity: 0.5 })).toMatchObject({ ok: false, code: 'INVALID_API_KEY' });
    expect(svc.running).toBe(false);
  });

  it('rewrites asar paths for files read by native code', () => {
    expect(unpackedPath('C:\\JARVIS\\resources\\app.asar\\node_modules\\x.pv')).toBe('C:\\JARVIS\\resources\\app.asar.unpacked\\node_modules\\x.pv');
    expect(unpackedPath('/dev/node_modules/x.pv')).toBe('/dev/node_modules/x.pv');
  });
});
