/**
 * תיקוני סקירה בבקר (זרימת הקול): עצירה, הקראה, הגנת הד, האזנת המשך, מילת הפעלה, אישורים, הודעות.
 * כל הבדיקות עם MOCK של שכבת האודיו, של window.jarvis ושל השעון.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SubmitResult, TranscribeResult } from '../../../src/shared/api-types';
import { defaultSettings, type Settings } from '../../../src/shared/settings-schema';
import type { ApprovalRequest, AssistantEvent, ReminderDTO } from '../../../src/shared/types';
import { isLikelyEcho } from '../../../src/renderer/audio/echo';
import { FOLLOW_UP_DELAY_MS, JarvisController, MAX_AUTO_FOLLOW_UPS, WAKE_TAIL_MS } from '../../../src/renderer/state/controller';
import { he } from '../../../src/renderer/i18n/he';
import { flush, mockAudio, mockClock, speechCapture } from './audio.mock';
import { mockJarvisApi } from './jarvis-api.mock';

function settingsWith(mut: (s: Settings) => void): Settings {
  const s = defaultSettings();
  mut(s);
  return s;
}

async function setup(opts: { settings?: Settings; nowOffset?: { v: number } } = {}) {
  const jarvis = mockJarvisApi({ settings: opts.settings ?? defaultSettings() });
  const audio = mockAudio();
  const clock = mockClock();
  let uuid = 0;
  const off = opts.nowOffset;
  const controller = new JarvisController({
    api: jarvis.api,
    audio: audio.factories,
    now: () => clock.now() + (off ? off.v : 0),
    timers: clock.timers,
    randomId: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
  });
  await controller.init();
  await flush();
  return { jarvis, audio, clock, controller };
}

const toastTexts = (c: JarvisController) => c.state.toasts.map((t) => t.text);
const reply = (turnId: string, text: string): AssistantEvent => ({ type: 'response', turnId, text, speak: true, mode: 'ai', actions: [] });
const azure = () => settingsWith((s) => (s.tts.provider = 'azure'));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('stop — a reply that was already on its way is not spoken (mock)', () => {
  it('stop while the turn is thinking: the late response is shown but never spoken (mock)', async () => {
    const { jarvis, audio, controller } = await setup({ settings: azure() });
    jarvis.emit({ type: 'turn-started', turnId: 't1', text: 'מה השעה', source: 'voice', mode: 'ai' });
    jarvis.emit({ type: 'phase', phase: 'THINKING', turnId: 't1' });
    controller.stop();
    expect(jarvis.api.assistant.cancel).toHaveBeenCalledWith('t1');
    // main כבר שלח את התשובה לפני שקיבל את הביטול
    jarvis.emit(reply('t1', 'השעה עשר.'));
    await flush();
    expect(jarvis.api.voice.synthesize).not.toHaveBeenCalled();
    expect(audio.playback.played).toHaveLength(0);
    expect(controller.state.audioPhase).toBe('IDLE');
    expect(controller.state.lastReply?.text).toBe('השעה עשר.');
  });

  it('stop while a voice submit is in flight cancels the new turn when the submit returns (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    const pending = deferred<SubmitResult>();
    vi.mocked(jarvis.api.assistant.submit).mockImplementationOnce(() => pending.promise);
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture());
    await flush();
    expect(jarvis.api.assistant.submit).toHaveBeenCalledTimes(1);
    // עוד אין תור פעיל (activeTurnId null) — המשתמש לוחץ "עצור"
    controller.stop();
    expect(jarvis.api.assistant.cancel).not.toHaveBeenCalled();
    pending.resolve({ ok: true, turnId: 't9', mode: 'ai' });
    await flush();
    expect(jarvis.api.assistant.cancel).toHaveBeenCalledWith('t9');
    jarvis.emit(reply('t9', 'פתחתי את EPLAN.'));
    await flush();
    expect(audio.speaker.spoken).toHaveLength(0);
  });

  it('a new turn after stop is spoken normally (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    jarvis.emit({ type: 'turn-started', turnId: 't1', text: 'א', source: 'text', mode: 'ai' });
    controller.stop();
    jarvis.emit({ type: 'turn-started', turnId: 't2', text: 'ב', source: 'text', mode: 'ai' });
    jarvis.emit(reply('t2', 'תשובה חדשה'));
    await flush();
    expect(audio.speaker.spoken.map((s) => s.text)).toEqual(['תשובה חדשה']);
  });

  it('stop cancels cloud work in flight: the prefetched chunk and the transcription (mock)', async () => {
    const { jarvis, audio, controller } = await setup({ settings: azure() });
    const second = deferred<Awaited<ReturnType<typeof jarvis.api.voice.synthesize>>>();
    let n = 0;
    vi.mocked(jarvis.api.voice.synthesize).mockImplementation(async () => {
      n++;
      if (n === 2) return second.promise;
      return { ok: true as const, audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/mpeg', provider: 'mock' };
    });
    const long = Array.from({ length: 200 }, (_, i) => `זה משפט מספר ${i} בתשובה ארוכה.`).join(' ');
    jarvis.emit(reply('t1', long));
    await flush();
    expect(audio.playback.played).toHaveLength(1);
    const prefetchId = vi.mocked(jarvis.api.voice.synthesize).mock.calls[1]?.[0].requestId;
    expect(prefetchId).toBeTruthy();
    controller.stop();
    expect(jarvis.api.voice.cancel).toHaveBeenCalledWith(prefetchId);
    second.resolve({ ok: true, audio: new Uint8Array([4]), mimeType: 'audio/mpeg', provider: 'mock' });
    await flush();
    expect(audio.playback.played).toHaveLength(1);

    // תמלול שבדרך
    const tr = deferred<TranscribeResult>();
    vi.mocked(jarvis.api.voice.transcribe).mockImplementationOnce(() => tr.promise);
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture());
    await flush();
    const trId = vi.mocked(jarvis.api.voice.transcribe).mock.calls[0]?.[0].requestId;
    expect(trId).toBeTruthy();
    controller.stop();
    expect(jarvis.api.voice.cancel).toHaveBeenCalledWith(trId);
    tr.resolve({ ok: false, code: 'CANCELLED', message_he: 'הבקשה בוטלה.' });
    await flush();
    expect(toastTexts(controller).join(' ')).not.toContain('בוטלה');
  });
});

describe('SPEAKING only while something is audible (mock)', () => {
  it('cloud TTS: SPEAKING starts at playback start, not when play() is called (mock)', async () => {
    const { jarvis, audio, controller } = await setup({ settings: azure() });
    audio.playback.holdStart = true;
    jarvis.emit(reply('t1', 'המשימה נוספה'));
    await flush();
    expect(audio.playback.played).toHaveLength(1);
    expect(controller.state.audioPhase).toBe('IDLE');
    expect(controller.state.speechActive).toBe(true);
    audio.playback.startNow();
    expect(controller.state.audioPhase).toBe('SPEAKING');
    audio.playback.end();
    await flush();
    expect(jarvis.audioPhases()).toEqual(['SPEAKING', 'IDLE']);
  });

  it('a multi-chunk reply stays SPEAKING between chunks (one reply) and reports SPEAKING once (mock)', async () => {
    const { jarvis, audio, controller } = await setup({ settings: azure() });
    const long = Array.from({ length: 200 }, (_, i) => `זה משפט מספר ${i} בתשובה ארוכה.`).join(' ');
    jarvis.emit(reply('t1', long));
    await flush();
    for (let i = 0; i < 6 && audio.playback.playing; i++) {
      expect(controller.state.audioPhase).toBe('SPEAKING');
      audio.playback.end();
      await flush();
    }
    expect(controller.state.audioPhase).toBe('IDLE');
    expect(jarvis.audioPhases()).toEqual(['SPEAKING', 'IDLE']);
  });

  it('system voice without a Hebrew voice never shows SPEAKING (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    audio.speaker.holdStart = true;
    jarvis.emit(reply('t1', 'שלום'));
    await flush();
    expect(controller.state.audioPhase).toBe('IDLE');
    audio.speaker.end('no-voice');
    await flush();
    expect(controller.state.audioPhase).toBe('IDLE');
    expect(jarvis.audioPhases()).not.toContain('SPEAKING');
    expect(toastTexts(controller)).toContain(he.toasts.noSystemVoice);
  });
});

describe('echo guard (mock)', () => {
  const question = 'לפתוח את פרויקט הגמר או את פרויקט המעבדה?';

  it('cloud TTS (echo-cancelled) + capture 2 s after speech: a real answer that repeats words of the question is submitted (mock)', async () => {
    const { jarvis, audio, clock, controller } = await setup({ settings: azure() });
    audio.factories.isLikelyEcho = isLikelyEcho;
    jarvis.emit(reply('t1', question));
    await flush();
    audio.playback.end();
    await flush();
    clock.advance(2000);
    vi.mocked(jarvis.api.voice.transcribe).mockResolvedValueOnce({ ok: true, text: 'את פרויקט המעבדה', provider: 'mock', durationMs: 900 });
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture());
    await flush();
    expect(vi.mocked(jarvis.api.assistant.submit).mock.calls[0]?.[0].text).toBe('את פרויקט המעבדה');
    expect(toastTexts(controller)).not.toContain(he.toasts.echoIgnored);
  });

  it('the gap is measured from capture START, not from transcript arrival (mock)', async () => {
    const { jarvis, audio, clock, controller } = await setup({ settings: azure() });
    audio.echo = true;
    jarvis.emit(reply('t1', question));
    await flush();
    audio.playback.end();
    await flush();
    clock.advance(300);
    await controller.toggleListen('ui');
    // ההקלטה והתמלול לוקחים זמן — לא משנה: ההקלטה התחילה 300ms אחרי סוף ההקראה
    clock.advance(4000);
    audio.mic.finish(speechCapture());
    await flush();
    expect(audio.echoCalls.at(-1)?.[2]).toBe(300);
    expect(jarvis.api.assistant.submit).not.toHaveBeenCalled();
  });

  it('system voice (no echo cancellation) is always checked inside the echo window (mock)', async () => {
    const { jarvis, audio, clock, controller } = await setup();
    audio.echo = true;
    jarvis.emit(reply('t1', question));
    await flush();
    audio.speaker.end();
    await flush();
    clock.advance(3000);
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture());
    await flush();
    expect(audio.echoCalls).toHaveLength(1);
    expect(toastTexts(controller)).toContain(he.toasts.echoIgnored);
  });
});

describe('follow-up listening (mock)', () => {
  const followUp = () => settingsWith((s) => (s.voice.followUpListening = true));

  it(`at most ${MAX_AUTO_FOLLOW_UPS} automatic follow-ups in a row without an explicit activation (mock)`, async () => {
    const { jarvis, audio, clock, controller } = await setup({ settings: followUp() });
    for (let i = 0; i < 5; i++) {
      jarvis.emit(reply(`t${i}`, `תשובה ${i}`));
      await flush();
      audio.speaker.end('ended');
      await flush();
      clock.advance(FOLLOW_UP_DELAY_MS);
      await flush();
      audio.mic.finish(speechCapture()); // דיבור ברקע (טלוויזיה)
      await flush();
    }
    expect(vi.mocked(jarvis.api.voice.transcribe).mock.calls).toHaveLength(MAX_AUTO_FOLLOW_UPS);
    expect(vi.mocked(jarvis.api.assistant.submit).mock.calls).toHaveLength(MAX_AUTO_FOLLOW_UPS);
    // הפעלה מפורשת מאפסת את המונה
    await controller.toggleListen('hotkey');
    audio.mic.finish(speechCapture());
    await flush();
    jarvis.emit(reply('t9', 'עוד משהו?'));
    await flush();
    audio.speaker.end('ended');
    await flush();
    clock.advance(FOLLOW_UP_DELAY_MS);
    await flush();
    expect(controller.state.audioPhase).toBe('LISTENING');
  });

  it('stop during the tail cancels the pending follow-up (mock)', async () => {
    const { jarvis, audio, clock, controller } = await setup({ settings: followUp() });
    jarvis.emit(reply('t1', 'משהו נוסף?'));
    await flush();
    audio.speaker.end('ended');
    await flush();
    controller.stop();
    clock.advance(FOLLOW_UP_DELAY_MS * 2);
    await flush();
    expect(audio.mic.startCalls).toHaveLength(0);
  });
});

describe('wake word — tail, reporting, approvals (mock)', () => {
  const wakeOn = () =>
    settingsWith((s) => {
      s.wakeWord.enabled = true;
      s.tts.provider = 'azure';
    });

  it('a wall-clock step back during the tail does not leave the detector paused (mock)', async () => {
    const off = { v: 0 };
    const { jarvis, audio, clock, controller } = await setup({ settings: wakeOn(), nowOffset: off });
    const det = audio.wakeDetectors[0]!;
    expect(det.state).toBe('listening');
    jarvis.emit(reply('t1', 'בוצע.'));
    await flush();
    expect(det.state).toBe('paused');
    audio.playback.end();
    await flush();
    off.v = -2000; // NTP / שינוי ידני של השעון
    clock.advance(WAKE_TAIL_MS + 50);
    expect(det.state).toBe('listening');
    expect(controller.state.wake.status).toBe('listening');
  });

  it('reports the wake-word status to main whenever it changes, not only on audio phases (mock)', async () => {
    const { jarvis, audio, controller } = await setup({ settings: wakeOn() });
    const calls = () => vi.mocked(jarvis.api.voice.reportAudioPhase).mock.calls.map((c) => [c[0], c[1]]);
    expect(calls()).toEqual([['IDLE', true]]);
    await controller.toggleListen('ui');
    expect(calls().at(-1)).toEqual(['LISTENING', false]);
    controller.stop();
    expect(calls().at(-1)).toEqual(['IDLE', true]);
    // תקלה במילת ההפעלה — המגש מפסיק להציג "מאזין"
    audio.wakeDetectors[0]!.failNow('המיקרופון התנתק או הפסיק לשדר.');
    expect(calls().at(-1)).toEqual(['IDLE', false]);
  });

  it('while an approval is pending the wake word is paused and detections are ignored (mock)', async () => {
    const { jarvis, audio, controller } = await setup({ settings: wakeOn() });
    const det = audio.wakeDetectors[0]!;
    jarvis.emit({ type: 'approval-required', request: approval('ap1') });
    expect(det.state).toBe('paused');
    det.trigger();
    jarvis.command({ type: 'toggle-listen', source: 'wakeword' });
    await flush();
    expect(audio.mic.startCalls).toHaveLength(0);
    jarvis.emit({ type: 'approval-resolved', approvalId: 'ap1', outcome: 'rejected' });
    expect(det.state).toBe('listening');
    expect(controller.state.wake.status).toBe('listening');
  });
});

function approval(id: string, turnId = 't1'): ApprovalRequest {
  return {
    approvalId: id,
    turnId,
    actionId: 'a1',
    tool: 'capture_screen_for_analysis',
    action_he: 'צילום מסך',
    target_he: 'מסך ראשי',
    impact_he: 'התמונה תישלח לניתוח',
    reason: 'privacy',
    expiresAt: '2026-10-05T09:01:00.000Z',
  };
}

describe('approvals — answering by voice (mock)', () => {
  it('push-to-talk during an approval is allowed; "כן" answering the same turn keeps the transcript and the dialog (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    jarvis.emit({ type: 'turn-started', turnId: 't1', text: 'תסתכל על המסך', source: 'text', mode: 'ai' });
    jarvis.emit({ type: 'phase', phase: 'AWAITING_APPROVAL', turnId: 't1' });
    jarvis.emit({ type: 'approval-required', request: approval('ap1') });
    vi.mocked(jarvis.api.voice.transcribe).mockResolvedValueOnce({ ok: true, text: 'כן', provider: 'mock', durationMs: 600 });
    vi.mocked(jarvis.api.assistant.submit).mockResolvedValueOnce({ ok: true, turnId: 't1', mode: 'ai' });
    await controller.toggleListen('hotkey');
    expect(controller.state.audioPhase).toBe('LISTENING');
    audio.mic.finish(speechCapture());
    await flush();
    expect(vi.mocked(jarvis.api.assistant.submit).mock.calls[0]?.[0]).toMatchObject({ text: 'כן', source: 'voice' });
    // אותו תור — לא "תור חדש": השורה והבקשה הפתוחה נשארות עד approval-resolved
    expect(controller.state.lastUser?.text).toBe('תסתכל על המסך');
    expect(controller.state.pendingApprovals).toHaveLength(1);
    jarvis.emit({ type: 'approval-resolved', approvalId: 'ap1', outcome: 'approved' });
    expect(controller.state.pendingApprovals).toHaveLength(0);
  });

  it('no automatic follow-up capture while an approval is pending (mock)', async () => {
    const { jarvis, audio, clock } = await setup({ settings: settingsWith((s) => (s.voice.followUpListening = true)) });
    jarvis.emit(reply('t1', 'לצלם את המסך?'));
    await flush();
    jarvis.emit({ type: 'approval-required', request: approval('ap2') });
    audio.speaker.end('ended');
    await flush();
    clock.advance(FOLLOW_UP_DELAY_MS + 10);
    await flush();
    expect(audio.mic.startCalls).toHaveLength(0);
  });
});

describe('a reply that arrives during a capture is deferred (mock)', () => {
  it('capture ends without speech → the deferred reply is spoken (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    await controller.toggleListen('ui');
    jarvis.emit(reply('t1', 'התזכורת נקבעה'));
    await flush();
    expect(audio.speaker.spoken).toHaveLength(0);
    audio.mic.finish(speechCapture({ speechDetected: false }));
    await flush();
    expect(audio.speaker.spoken.map((s) => s.text)).toEqual(['התזכורת נקבעה']);
  });

  it('capture that submits a new request drops the deferred reply (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    await controller.toggleListen('ui');
    jarvis.emit(reply('t1', 'תשובה ישנה'));
    audio.mic.finish(speechCapture());
    await flush();
    expect(jarvis.api.assistant.submit).toHaveBeenCalledTimes(1);
    expect(audio.speaker.spoken).toHaveLength(0);
  });

  it('stop during the capture drops the deferred reply (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    await controller.toggleListen('ui');
    jarvis.emit(reply('t1', 'תשובה'));
    controller.stop();
    await flush();
    expect(audio.speaker.spoken).toHaveLength(0);
  });
});

describe('Hebrew-only messages (mock)', () => {
  it('an empty transcript (e.g. Azure BabbleTimeout) is the "no speech" flow, not an error (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    vi.mocked(jarvis.api.voice.transcribe).mockResolvedValueOnce({ ok: false, code: 'EMPTY_TRANSCRIPT', message_he: 'לא זוהה דיבור בהקלטה.' });
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture());
    await flush();
    expect(toastTexts(controller)).toEqual([he.toasts.noSpeech]);
    expect(controller.state.errorActive).toBe(false);
  });

  it('Electron "Error invoking remote method" text never reaches a toast (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    vi.mocked(jarvis.api.voice.transcribe).mockRejectedValueOnce(new Error("Error invoking remote method 'voice:transcribe': Error: INVALID_PARAMS"));
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture());
    await flush();
    const text = toastTexts(controller).join(' ');
    expect(text).toContain(he.errors.ipc);
    expect(text).not.toMatch(/Error|invoking|voice:|INVALID_PARAMS/);
  });

  it('a failed cancel shows a Hebrew message without technical ids (mock)', async () => {
    const { jarvis, controller } = await setup();
    vi.mocked(jarvis.api.assistant.cancel).mockRejectedValueOnce(new Error('boom'));
    jarvis.emit({ type: 'turn-started', turnId: 't1', text: 'x', source: 'text', mode: 'ai' });
    controller.stop();
    await flush();
    expect(toastTexts(controller)).toContain(he.errors.cancelFailed);
    expect(toastTexts(controller).join(' ')).not.toMatch(/cancel/);
  });

  it('transcription test: mic errors and STT errors get different messages (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    audio.mic.failNextStart = Object.assign(new Error('busy'), { name: 'MicError', kind: 'device-busy' });
    const micFail = await controller.runTranscriptionTest();
    expect(micFail).toEqual({ ok: false, message: he.mic.deviceBusy });

    vi.mocked(jarvis.api.voice.transcribe).mockRejectedValueOnce(new Error("Error invoking remote method 'voice:transcribe': Error: INTERNAL"));
    const test = controller.runTranscriptionTest();
    await flush();
    audio.mic.finish(speechCapture({ reason: 'max-duration' }));
    const sttFail = await test;
    expect(sttFail.ok).toBe(false);
    if (!sttFail.ok) {
      expect(sttFail.message).toBe(he.toasts.transcribeFailed(he.errors.ipc));
      expect(sttFail.message).not.toContain('המיקרופון');
    }
  });
});

describe('missed-reminders banner (mock)', () => {
  const reminder = (id: string): ReminderDTO => ({
    id,
    text: 'להתקשר לאמא',
    dueAtUtc: '2026-10-05T05:00:00.000Z',
    dueLocal_he: 'יום שני, 5 באוקטובר 2026 בשעה 08:00',
    timezone: 'Asia/Jerusalem',
    status: 'missed',
    createdAt: '2026-10-04T05:00:00.000Z',
    firedAt: null,
  });

  it('data-changed "reminders" re-fetches the list and prunes entries that are no longer missed (mock)', async () => {
    const { jarvis, controller } = await setup();
    jarvis.emit({ type: 'missed-reminders', reminders: [reminder('r1'), reminder('r2')] });
    expect(controller.state.missedReminders).toHaveLength(2);
    jarvis.snapshot = { phase: 'IDLE', activeTurnId: null, pendingApprovals: [], missedReminders: [reminder('r2')] };
    jarvis.emit({ type: 'data-changed', scope: 'reminders' });
    await flush();
    expect(controller.state.missedReminders.map((r) => r.id)).toEqual(['r2']);
  });
});
