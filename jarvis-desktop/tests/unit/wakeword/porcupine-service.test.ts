import { describe, expect, it, vi } from 'vitest';
import {
  createPorcupineService,
  isMissingNativeDependency,
  mapPorcupineError,
  PROCESS_ERRORS_TO_FAIL,
  SESSION_FAILED_MESSAGE,
  unpackedPath,
  VCREDIST_MESSAGE,
} from '../../../src/main/wakeword/porcupine-service';
import { silentLogger } from '../../../src/main/app/logger';

/** MOCK של @picovoice/porcupine-node — הספרייה האמיתית דורשת AccessKey ואימות אונליין. */
function mockModule(opts: { throwOnInit?: Error; detectAtCall?: number; throwOnProcess?: boolean } = {}) {
  const calls: { init: unknown[] | null; inits: number; frames: number; released: boolean; releases: number } = {
    init: null,
    inits: 0,
    frames: 0,
    released: false,
    releases: 0,
  };
  class Porcupine {
    readonly frameLength = 512;
    readonly sampleRate = 16000;
    constructor(...args: unknown[]) {
      if (opts.throwOnInit) throw opts.throwOnInit;
      calls.init = args;
      calls.inits++;
    }
    process(frame: Int16Array): number {
      expect(frame.length).toBe(512);
      calls.frames++;
      if (opts.throwOnProcess) throw new Error('MOCK: invalid state');
      return opts.detectAtCall === calls.frames ? 0 : -1;
    }
    release() {
      calls.released = true;
      calls.releases++;
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
    const svc = createPorcupineService({ getAccessKey: () => 'pv-key-123', logger: silentLogger, loadModule: () => m.module, newSessionId: () => 'session-1' });
    expect(svc.start({ sensitivity: 0.99 })).toEqual({ ok: true, frameLength: 512, sampleRate: 16000, sessionId: 'session-1' });
    const [key, keywords, sens] = m.calls.init as [string, string[], number[]];
    expect(key).toBe('pv-key-123');
    expect(keywords[0]).toContain('app.asar.unpacked');
    expect(keywords[0]).toMatch(/jarvis_windows\.ppn$/);
    expect(sens).toEqual([0.95]);
    expect(svc.running).toBe(true);
  });

  it('buffers arbitrary chunk sizes into 512-sample frames and reports detection', () => {
    const m = mockModule({ detectAtCall: 3 });
    const svc = createPorcupineService({ getAccessKey: () => 'k', logger: silentLogger, loadModule: () => m.module, newSessionId: () => 's1' });
    svc.start({ sensitivity: 0.5 });
    expect(svc.process('s1', new Int16Array(700))).toBe(false); // 700 → פריים 1, נשארו 188
    expect(svc.process('s1', new Int16Array(700))).toBe(false); // 888 → פריים 2, נשארו 376
    expect(m.calls.frames).toBe(2);
    expect(svc.process('s1', new Int16Array(200))).toBe(true); // 576 → פריים 3 = זיהוי
    expect(m.calls.frames).toBe(3);
    svc.stop('s1');
    expect(m.calls.released).toBe(true);
    expect(svc.process('s1', new Int16Array(1024))).toBe(false);
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

  it('a stale detector cannot stop or feed the session of the new detector (mock)', () => {
    const m = mockModule();
    let n = 0;
    const svc = createPorcupineService({ getAccessKey: () => 'k', logger: silentLogger, loadModule: () => m.module, newSessionId: () => `s${++n}` });
    const first = svc.start({ sensitivity: 0.5 });
    const second = svc.start({ sensitivity: 0.5 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.sessionId).not.toBe(first.sessionId);
    // אותה רגישות: המנוע הטעון נשאר (האתחול מאמת מפתח מול Picovoice — יקר)
    expect(m.calls.inits).toBe(1);
    // הגלאי הישן עוצר מאוחר — המנוע של הגלאי החדש ממשיך לרוץ
    svc.stop(first.sessionId);
    expect(svc.running).toBe(true);
    expect(m.calls.released).toBe(false);
    expect(svc.status(first.sessionId)).toEqual({ state: 'stopped' });
    expect(svc.status(second.sessionId)).toEqual({ state: 'running' });
    // פריימים מהגלאי הישן (מיקרופון "יתום") לא מגיעים למנוע
    expect(svc.process(first.sessionId, new Int16Array(1024))).toBe(false);
    expect(m.calls.frames).toBe(0);
    svc.process(second.sessionId, new Int16Array(1024));
    expect(m.calls.frames).toBe(2);
    // שינוי רגישות: המנוע נטען מחדש
    const third = svc.start({ sensitivity: 0.8 });
    expect(third.ok).toBe(true);
    expect(m.calls.inits).toBe(2);
    expect(m.calls.releases).toBe(1);
    // עצירה בלי מזהה (יציאה מהאפליקציה) עוצרת הכול
    svc.stop();
    expect(svc.running).toBe(false);
  });

  it('repeated process errors mark the session failed so the renderer can see it in status (mock)', () => {
    const m = mockModule({ throwOnProcess: true });
    const svc = createPorcupineService({ getAccessKey: () => 'k', logger: silentLogger, loadModule: () => m.module, newSessionId: () => 's1' });
    svc.start({ sensitivity: 0.5 });
    expect(svc.status('s1')).toEqual({ state: 'running' });
    svc.process('s1', new Int16Array(512 * (PROCESS_ERRORS_TO_FAIL - 1)));
    expect(svc.status('s1')).toEqual({ state: 'running' });
    svc.process('s1', new Int16Array(512));
    expect(svc.status('s1')).toEqual({ state: 'failed', message_he: SESSION_FAILED_MESSAGE });
    expect(svc.running).toBe(false);
    expect(m.calls.released).toBe(true);
    // הפעלה חדשה (ניסיון חוזר מה-renderer) מתחילה סשן נקי
    const again = createPorcupineService({ getAccessKey: () => 'k', logger: silentLogger, loadModule: () => mockModule().module, newSessionId: () => 's2' });
    expect(again.start({ sensitivity: 0.5 })).toMatchObject({ ok: true, sessionId: 's2' });
  });

  it('a missing native dependency (VC++ runtime) gets a clear Hebrew explanation (mock)', () => {
    const notFound = Object.assign(new Error("Cannot find module 'x'"), { code: 'MODULE_NOT_FOUND' });
    const win126 = Object.assign(new Error('\\?\\C:\\JARVIS\\pv_porcupine.node failed to load (LoadLibrary error 126)'), { code: 'ERR_DLOPEN_FAILED' });
    const winText = new Error('The specified module could not be found.\r\n\\?\\C:\\JARVIS\\pv_porcupine.node');
    for (const err of [notFound, win126, winText]) {
      expect(isMissingNativeDependency(err)).toBe(true);
      expect(mapPorcupineError(err)).toEqual({ code: 'PROVIDER_UNAVAILABLE', message_he: VCREDIST_MESSAGE });
    }
    // מספר 126 שאינו בהקשר של טעינת ספרייה — לא
    expect(isMissingNativeDependency(new Error('activation failed after 126 attempts'))).toBe(false);
    expect(VCREDIST_MESSAGE).toContain('Visual C++ Redistributable');
    const svc = createPorcupineService({
      getAccessKey: () => 'k',
      logger: silentLogger,
      loadModule: () => {
        throw winText;
      },
    });
    expect(svc.start({ sensitivity: 0.5 })).toEqual({ ok: false, code: 'PROVIDER_UNAVAILABLE', message_he: VCREDIST_MESSAGE });
  });

  it('rewrites asar paths for files read by native code', () => {
    expect(unpackedPath('C:\\JARVIS\\resources\\app.asar\\node_modules\\x.pv')).toBe('C:\\JARVIS\\resources\\app.asar.unpacked\\node_modules\\x.pv');
    expect(unpackedPath('/dev/node_modules/x.pv')).toBe('/dev/node_modules/x.pv');
  });
});
