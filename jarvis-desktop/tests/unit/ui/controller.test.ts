import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, type Settings } from '../../../src/shared/settings-schema';
import type { ApprovalRequest, ReminderDTO } from '../../../src/shared/types';
import { JarvisController, WAKE_TAIL_MS, type BatteryLike } from '../../../src/renderer/state/controller';
import { deriveDisplayState } from '../../../src/renderer/state/derive';
import { he } from '../../../src/renderer/i18n/he';
import { flush, mockAudio, mockClock, speechCapture } from './audio.mock';
import { mockJarvisApi } from './jarvis-api.mock';

function settingsWith(mut: (s: Settings) => void): Settings {
  const s = defaultSettings();
  mut(s);
  return s;
}

async function setup(opts: { settings?: Settings; battery?: BatteryLike } = {}) {
  const jarvis = mockJarvisApi({ settings: opts.settings ?? defaultSettings() });
  const audio = mockAudio();
  const clock = mockClock();
  let uuid = 0;
  const controller = new JarvisController({
    api: jarvis.api,
    audio: audio.factories,
    now: clock.now,
    timers: clock.timers,
    randomId: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
    ...(opts.battery ? { getBattery: () => Promise.resolve(opts.battery as BatteryLike) } : {}),
  });
  await controller.init();
  await flush();
  return { jarvis, audio, clock, controller };
}

function displayState(c: JarvisController) {
  const s = c.state;
  return deriveDisplayState({
    enginePhase: s.enginePhase,
    audioPhase: s.audioPhase,
    pendingApproval: s.pendingApprovals.length > 0,
    errorActive: s.errorActive,
  });
}

function toastTexts(c: JarvisController): string[] {
  return c.state.toasts.map((t) => t.text);
}

const response = (text: string, speak = true) =>
  ({ type: 'response', turnId: 'turn-9', text, speak, mode: 'ai', actions: [] }) as const;

describe('JarvisController — voice flow (mock)', () => {
  it('mic -> transcribe -> submit (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    await controller.toggleListen('ui');
    expect(audio.mic.startCalls).toHaveLength(1);
    expect(audio.mic.startCalls[0]).toMatchObject({ silenceTimeoutMs: 1300, maxUtteranceSec: 15, deviceId: undefined });
    expect(controller.state.audioPhase).toBe('LISTENING');
    expect(displayState(controller)).toBe('LISTENING');
    expect(controller.getLevelSource().kind).toBe('mic');

    audio.mic.finish(speechCapture({ durationMs: 1499.6 }));
    await flush();

    expect(jarvis.api.voice.transcribe).toHaveBeenCalledTimes(1);
    const req = vi.mocked(jarvis.api.voice.transcribe).mock.calls[0]?.[0];
    expect(req?.mimeType).toBe('audio/wav');
    expect(req?.durationMs).toBe(1500);
    expect(req?.audio.byteLength).toBe(3200);
    expect(jarvis.api.assistant.submit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(jarvis.api.assistant.submit).mock.calls[0]?.[0]).toMatchObject({ text: 'תפתח את EPLAN', source: 'voice' });
    expect(vi.mocked(jarvis.api.assistant.submit).mock.calls[0]?.[0].clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(jarvis.audioPhases()).toEqual(['LISTENING', 'TRANSCRIBING', 'IDLE']);
    expect(controller.state.audioPhase).toBe('IDLE');
    expect(controller.state.lastUser).toMatchObject({ text: 'תפתח את EPLAN', source: 'voice' });
  });

  it('second toggle while listening ends the capture manually and sends it (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    await controller.toggleListen('ui');
    const second = controller.toggleListen('ui');
    await second;
    await flush();
    expect(audio.mic.stopCalls).toBe(1);
    expect(audio.mic.startCalls).toHaveLength(1);
    expect(jarvis.api.voice.transcribe).toHaveBeenCalledTimes(1);
    expect(jarvis.api.assistant.submit).toHaveBeenCalledTimes(1);
  });

  it('does not open the mic twice while it is still starting (mock)', async () => {
    const { audio, controller } = await setup();
    audio.mic.holdStart = true;
    const first = controller.toggleListen('ui');
    await flush();
    expect(controller.state.micStarting).toBe(true);
    // עד שהמיקרופון באמת פעיל — המצב לא LISTENING
    expect(controller.state.audioPhase).toBe('IDLE');
    await controller.toggleListen('ui');
    expect(audio.mic.startCalls).toHaveLength(1);
    audio.mic.resolveStart();
    await first;
    expect(controller.state.audioPhase).toBe('LISTENING');
    expect(controller.state.micStarting).toBe(false);
  });

  it('stop while the mic is opening cancels it — the mic is not left open (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    audio.mic.holdStart = true;
    const pending = controller.toggleListen('ui');
    await flush();
    controller.stop();
    audio.mic.resolveStart();
    await pending;
    await flush();
    expect(audio.mic.cancelCalls).toBeGreaterThanOrEqual(1);
    expect(audio.mic.active).toBe(false);
    expect(controller.state.audioPhase).toBe('IDLE');
    expect(jarvis.audioPhases()).not.toContain('LISTENING');
  });

  it('no speech detected -> back to IDLE with "לא שמעתי דיבור" and nothing is transcribed (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture({ speechDetected: false }));
    await flush();
    expect(jarvis.api.voice.transcribe).not.toHaveBeenCalled();
    expect(controller.state.audioPhase).toBe('IDLE');
    expect(toastTexts(controller)).toContain('לא שמעתי דיבור');
  });

  it('cancelled capture -> back to IDLE silently (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture({ reason: 'cancelled', speechDetected: false, wav: new Uint8Array(0) }));
    await flush();
    expect(jarvis.api.voice.transcribe).not.toHaveBeenCalled();
    expect(controller.state.audioPhase).toBe('IDLE');
    expect(toastTexts(controller)).not.toContain('לא שמעתי דיבור');
  });

  it('stt provider "none" -> toast and the mic is never opened (mock)', async () => {
    const { audio, controller } = await setup({ settings: settingsWith((s) => (s.stt.provider = 'none')) });
    await controller.toggleListen('ui');
    expect(audio.mic.startCalls).toHaveLength(0);
    expect(toastTexts(controller)).toContain('תמלול לא מוגדר — בחר ספק תמלול בהגדרות ← קול');
    expect(controller.state.audioPhase).toBe('IDLE');
  });

  it('echo transcript is ignored with a small notice and not submitted (mock)', async () => {
    const { jarvis, audio, clock, controller } = await setup();
    // JARVIS מדבר (קול מערכת), מסיים, ואז "שומע" את עצמו
    jarvis.emit(response('הפרויקט נפתח בהצלחה'));
    await flush();
    audio.speaker.end();
    await flush();
    clock.advance(800);
    vi.mocked(jarvis.api.voice.transcribe).mockResolvedValueOnce({ ok: true, text: 'הפרויקט נפתח בהצלחה', provider: 'mock', durationMs: 1200 });
    audio.echo = true;
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture());
    await flush();
    expect(audio.echoCalls.at(-1)).toEqual(['הפרויקט נפתח בהצלחה', 'הפרויקט נפתח בהצלחה', 800]);
    expect(jarvis.api.assistant.submit).not.toHaveBeenCalled();
    expect(toastTexts(controller)).toContain(he.toasts.echoIgnored);
  });

  it('passes Infinity as msSinceSpeechEnded when JARVIS never spoke (mock)', async () => {
    const { audio, controller } = await setup();
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture());
    await flush();
    expect(audio.echoCalls[0]?.[1]).toBeNull();
    expect(audio.echoCalls[0]?.[2]).toBe(Number.POSITIVE_INFINITY);
  });

  it('stop during transcription discards the result — nothing is submitted (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    let release!: (v: Awaited<ReturnType<typeof jarvis.api.voice.transcribe>>) => void;
    vi.mocked(jarvis.api.voice.transcribe).mockImplementationOnce(() => new Promise((r) => (release = r)));
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture());
    await flush();
    expect(controller.state.audioPhase).toBe('TRANSCRIBING');
    expect(displayState(controller)).toBe('THINKING');
    controller.stop();
    expect(controller.state.audioPhase).toBe('IDLE');
    release({ ok: true, text: 'משהו', provider: 'mock', durationMs: 1000 });
    await flush();
    expect(jarvis.api.assistant.submit).not.toHaveBeenCalled();
  });

  it('transcription failure shows the Hebrew message and ERROR briefly (mock)', async () => {
    const { jarvis, audio, clock, controller } = await setup();
    vi.mocked(jarvis.api.voice.transcribe).mockResolvedValueOnce({ ok: false, code: 'NETWORK', message_he: 'אין חיבור לאינטרנט' });
    await controller.toggleListen('ui');
    audio.mic.finish(speechCapture());
    await flush();
    expect(toastTexts(controller)).toContain(he.toasts.transcribeFailed('אין חיבור לאינטרנט'));
    expect(displayState(controller)).toBe('ERROR');
    clock.advance(7000);
    expect(displayState(controller)).toBe('IDLE');
    expect(jarvis.api.assistant.submit).not.toHaveBeenCalled();
  });

  it('mic permission denied -> Windows privacy settings guidance (mock)', async () => {
    const { audio, controller } = await setup();
    audio.mic.failNextStart = Object.assign(new Error('denied'), { name: 'MicError', kind: 'permission-denied' });
    await controller.toggleListen('ui');
    const text = toastTexts(controller).join('\n');
    expect(text).toContain('פרטיות ואבטחה');
    expect(text).toContain('מיקרופון');
    expect(controller.state.audioPhase).toBe('IDLE');
    expect(controller.state.micStarting).toBe(false);
  });

  it('text input submits with source "text" and blocks double submit (mock)', async () => {
    const { jarvis, controller } = await setup();
    let release!: (v: Awaited<ReturnType<typeof jarvis.api.assistant.submit>>) => void;
    vi.mocked(jarvis.api.assistant.submit).mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = controller.submitText('  מה השעה  ');
    const second = await controller.submitText('מה השעה');
    expect(second).toBe(false);
    release({ ok: true, turnId: 't1', mode: 'local' });
    expect(await first).toBe(true);
    expect(jarvis.api.assistant.submit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(jarvis.api.assistant.submit).mock.calls[0]?.[0]).toMatchObject({ text: 'מה השעה', source: 'text' });
  });
});

describe('JarvisController — speech output (mock)', () => {
  it('speaks responses with the system voice and keeps lastSpokenText (mock)', async () => {
    const { audio, controller, jarvis } = await setup();
    jarvis.emit(response('שלום אורי'));
    await flush();
    expect(audio.speaker.spoken).toEqual([{ text: 'שלום אורי', voiceName: undefined, rate: 1 }]);
    expect(controller.state.audioPhase).toBe('SPEAKING');
    expect(controller.state.speechOutput).toBe('system');
    // בקול מערכת אין גישה לאות — אין waveform
    expect(controller.getLevelSource().kind).toBe('system');
    audio.speaker.end();
    await flush();
    expect(controller.state.audioPhase).toBe('IDLE');
  });

  it('does not speak when speak=false or autoSpeak is off or provider is none (mock)', async () => {
    const a = await setup();
    a.jarvis.emit(response('לא להקריא', false));
    await flush();
    expect(a.audio.speaker.spoken).toHaveLength(0);

    const b = await setup({ settings: settingsWith((s) => (s.tts.autoSpeak = false)) });
    b.jarvis.emit(response('לא להקריא'));
    await flush();
    expect(b.audio.speaker.spoken).toHaveLength(0);

    const c = await setup({ settings: settingsWith((s) => (s.tts.provider = 'none')) });
    c.jarvis.emit(response('לא להקריא'));
    await flush();
    expect(c.audio.speaker.spoken).toHaveLength(0);
    expect(c.jarvis.api.voice.synthesize).not.toHaveBeenCalled();
  });

  it('cloud TTS plays the synthesized audio; SPEAKING only once playback starts (mock)', async () => {
    const { audio, controller, jarvis } = await setup({ settings: settingsWith((s) => (s.tts.provider = 'azure')) });
    let release!: (v: Awaited<ReturnType<typeof jarvis.api.voice.synthesize>>) => void;
    vi.mocked(jarvis.api.voice.synthesize).mockImplementationOnce(() => new Promise((r) => (release = r)));
    jarvis.emit(response('המשימה נוספה'));
    await flush();
    expect(controller.state.audioPhase).toBe('IDLE');
    release({ ok: true, audio: new Uint8Array(10), mimeType: 'audio/mpeg', provider: 'azure' });
    await flush();
    expect(audio.playback.played).toEqual([{ bytes: 10, mimeType: 'audio/mpeg' }]);
    expect(controller.state.audioPhase).toBe('SPEAKING');
    expect(controller.getLevelSource().kind).toBe('playback');
    audio.playback.end();
    await flush();
    expect(controller.state.audioPhase).toBe('IDLE');
  });

  it('synthesis failure falls back to the system voice with a toast (mock)', async () => {
    const { audio, controller, jarvis } = await setup({ settings: settingsWith((s) => (s.tts.provider = 'openai')) });
    vi.mocked(jarvis.api.voice.synthesize).mockResolvedValueOnce({ ok: false, code: 'MISSING_API_KEY', message_he: 'חסר מפתח OpenAI' });
    jarvis.emit(response('התזכורת נקבעה'));
    await flush();
    expect(audio.playback.played).toHaveLength(0);
    expect(audio.speaker.spoken.map((s) => s.text)).toEqual(['התזכורת נקבעה']);
    expect(toastTexts(controller)).toContain(he.toasts.synthFallback('חסר מפתח OpenAI'));
    expect(controller.state.speechOutput).toBe('system');
  });

  it('IPC rejection of synthesize also falls back to the system voice (mock)', async () => {
    const { audio, jarvis } = await setup({ settings: settingsWith((s) => (s.tts.provider = 'azure')) });
    vi.mocked(jarvis.api.voice.synthesize).mockRejectedValueOnce(new Error('INVALID_PARAMS'));
    jarvis.emit(response('טקסט'));
    await flush();
    expect(audio.speaker.spoken.map((s) => s.text)).toEqual(['טקסט']);
  });

  it('long replies are synthesized in chunks within the 1500-char IPC limit (mock)', async () => {
    const { audio, jarvis } = await setup({ settings: settingsWith((s) => (s.tts.provider = 'azure')) });
    const sentence = 'זה משפט ארוך למדי שנועד לבדוק חלוקה לקטעים. ';
    const long = sentence.repeat(80);
    jarvis.emit(response(long));
    await flush();
    const calls = vi.mocked(jarvis.api.voice.synthesize).mock.calls.map((c) => c[0].text);
    expect(calls.length).toBeGreaterThanOrEqual(2); // הקטע הבא נטען מראש בזמן ההשמעה
    for (const t of calls) expect(t.length).toBeLessThanOrEqual(1500);
    audio.playback.end();
    await flush();
    audio.playback.end();
    await flush();
    audio.playback.end();
    await flush();
    expect(audio.playback.played.length).toBeGreaterThanOrEqual(2);
  });

  it('barge-in: pressing the mic while speaking stops playback first, then listens (mock)', async () => {
    const { audio, controller, jarvis } = await setup({ settings: settingsWith((s) => (s.tts.provider = 'azure')) });
    jarvis.emit(response('הנה התשובה הארוכה'));
    await flush();
    expect(controller.state.audioPhase).toBe('SPEAKING');
    await controller.toggleListen('ui');
    const stopIdx = audio.log.indexOf('playback.stop');
    const startIdx = audio.log.indexOf('mic.start');
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThan(stopIdx);
    expect(controller.state.audioPhase).toBe('LISTENING');
    expect(controller.state.speechOutput).toBe('none');
    // ההשמעה שנעצרה לא מפעילה האזנת המשך ולא מחזירה את המצב ל-IDLE
    await flush();
    expect(controller.state.audioPhase).toBe('LISTENING');
    expect(audio.mic.startCalls).toHaveLength(1);
  });

  it('barge-in also stops the system voice (mock)', async () => {
    const { audio, controller, jarvis } = await setup();
    jarvis.emit(response('קול מערכת מדבר'));
    await flush();
    await controller.toggleListen('hotkey');
    expect(audio.log.indexOf('system.stop')).toBeLessThan(audio.log.indexOf('mic.start'));
    expect(controller.state.audioPhase).toBe('LISTENING');
  });

  it('follow-up listening starts after speech ends when enabled (mock)', async () => {
    const { audio, controller, jarvis } = await setup({ settings: settingsWith((s) => (s.voice.followUpListening = true)) });
    jarvis.emit(response('מה עוד?'));
    await flush();
    audio.speaker.end();
    await flush();
    expect(audio.mic.startCalls).toHaveLength(1);
    expect(controller.state.audioPhase).toBe('LISTENING');
  });

  it('no follow-up listening when speech was stopped (mock)', async () => {
    const { audio, controller, jarvis } = await setup({ settings: settingsWith((s) => (s.voice.followUpListening = true)) });
    jarvis.emit(response('מה עוד?'));
    await flush();
    controller.stop();
    await flush();
    expect(audio.mic.startCalls).toHaveLength(0);
  });

  it('a response that arrives while the user is already talking is not spoken over them (mock)', async () => {
    const { audio, controller, jarvis } = await setup();
    await controller.toggleListen('ui');
    jarvis.emit(response('תשובה מאוחרת'));
    await flush();
    expect(audio.speaker.spoken).toHaveLength(0);
    expect(controller.state.lastReply?.text).toBe('תשובה מאוחרת');
  });

  it('missing system voice shows the Windows install hint (mock)', async () => {
    const { audio, controller, jarvis } = await setup();
    jarvis.emit(response('שלום'));
    await flush();
    audio.speaker.end('no-voice');
    await flush();
    expect(toastTexts(controller).join('\n')).toContain('הוסף קולות');
    expect(controller.state.audioPhase).toBe('IDLE');
  });
});

describe('JarvisController — stop & cancel (mock)', () => {
  it('stop cancels the active turn via assistant.cancel (mock)', async () => {
    const { jarvis, controller } = await setup();
    jarvis.emit({ type: 'turn-started', turnId: 'turn-42', text: 'תפתח EPLAN', source: 'text', mode: 'ai' });
    jarvis.emit({ type: 'phase', phase: 'THINKING', turnId: 'turn-42' });
    expect(displayState(controller)).toBe('THINKING');
    controller.stop();
    expect(jarvis.api.assistant.cancel).toHaveBeenCalledWith('turn-42');
  });

  it('stop with nothing active does not call cancel (mock)', async () => {
    const { jarvis, controller } = await setup();
    controller.stop();
    expect(jarvis.api.assistant.cancel).not.toHaveBeenCalled();
  });

  it('stop while listening cancels the mic and reports IDLE (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    await controller.toggleListen('ui');
    controller.stop();
    await flush();
    expect(audio.mic.cancelCalls).toBe(1);
    expect(jarvis.api.voice.transcribe).not.toHaveBeenCalled();
    expect(jarvis.audioPhases()).toEqual(['LISTENING', 'IDLE']);
  });

  it('stop command from main (Esc hotkey / tray) stops speech (mock)', async () => {
    const { jarvis, audio, controller } = await setup();
    jarvis.emit(response('מדבר'));
    await flush();
    jarvis.command({ type: 'stop' });
    expect(audio.speaker.stopCalls).toBe(1);
    expect(controller.state.audioPhase).toBe('IDLE');
  });

  it('turn-ended clears the active turn (mock)', async () => {
    const { jarvis, controller } = await setup();
    jarvis.emit({ type: 'turn-started', turnId: 't7', text: 'x', source: 'voice', mode: 'ai' });
    expect(controller.state.activeTurnId).toBe('t7');
    expect(controller.state.awaitingReply).toBe(true);
    jarvis.emit({ type: 'turn-ended', turnId: 't7', outcome: 'completed' });
    expect(controller.state.activeTurnId).toBeNull();
    expect(controller.state.awaitingReply).toBe(false);
  });
});

describe('JarvisController — wake word (mock)', () => {
  const wakeOn = (engine: 'openwakeword' | 'porcupine' = 'openwakeword') =>
    settingsWith((s) => {
      s.wakeWord.enabled = true;
      s.wakeWord.engine = engine;
      s.wakeWord.sensitivity = 0.6;
    });

  it('starts the detector with the configured sensitivity and starts listening on detection (mock)', async () => {
    const { audio, controller } = await setup({ settings: wakeOn() });
    const det = audio.wakeDetectors[0];
    expect(det?.startOptions?.sensitivity).toBe(0.6);
    expect(controller.state.wake.status).toBe('listening');
    det?.trigger();
    await flush();
    expect(audio.mic.startCalls).toHaveLength(1);
    expect(controller.state.audioPhase).toBe('LISTENING');
    // בזמן האזנה הגלאי מושהה
    expect(det?.state).toBe('paused');
  });

  it('wake word failure shows a clear status and push-to-talk keeps working (mock)', async () => {
    const jarvisSettings = wakeOn('porcupine');
    const jarvis = mockJarvisApi({ settings: jarvisSettings });
    const audio = mockAudio();
    audio.wakeFailReason = 'חסר מפתח Picovoice';
    const clock = mockClock();
    const controller = new JarvisController({
      api: jarvis.api,
      audio: audio.factories,
      now: clock.now,
      timers: clock.timers,
      randomId: () => '00000000-0000-4000-8000-000000000001',
    });
    await controller.init();
    await flush();
    expect(controller.state.wake.status).toBe('error');
    expect(controller.state.wake.error).toBe('מילת ההפעלה לא זמינה: חסר מפתח Picovoice. לחיצה לדיבור ממשיכה לעבוד.');
    expect(toastTexts(controller)).toContain(controller.state.wake.error);
    await controller.toggleListen('ui');
    expect(controller.state.audioPhase).toBe('LISTENING');
  });

  it('factory that throws (engine unavailable) is handled the same way (mock)', async () => {
    const jarvis = mockJarvisApi({ settings: wakeOn() });
    const audio = mockAudio();
    audio.factories.createWakeWordDetector = () => {
      throw new Error('המודל לא נטען');
    };
    const clock = mockClock();
    const controller = new JarvisController({ api: jarvis.api, audio: audio.factories, now: clock.now, timers: clock.timers, randomId: () => 'x' });
    await controller.init();
    await flush();
    expect(controller.state.wake.status).toBe('error');
    expect(controller.state.wake.error).toContain('המודל לא נטען');
  });

  it('wake word stays paused while speaking plus a 600 ms tail (mock)', async () => {
    const { audio, clock, controller, jarvis } = await setup({ settings: wakeOn() });
    const det = audio.wakeDetectors[0];
    jarvis.emit(response('אני מדבר עכשיו'));
    await flush();
    expect(det?.state).toBe('paused');
    audio.speaker.end();
    await flush();
    expect(det?.state).toBe('paused');
    // זיהוי בזמן הזנב (למשל JARVIS שמע את עצמו אומר "JARVIS") — מתעלמים
    det?.trigger();
    jarvis.command({ type: 'toggle-listen', source: 'wakeword' });
    await flush();
    expect(audio.mic.startCalls).toHaveLength(0);
    clock.advance(WAKE_TAIL_MS + 50);
    expect(det?.state).toBe('listening');
    expect(controller.state.wake.status).toBe('listening');
  });

  it('Porcupine detection from main (toggle-listen/wakeword) starts listening but never ends a capture (mock)', async () => {
    const { audio, controller, jarvis } = await setup({ settings: wakeOn('porcupine') });
    jarvis.command({ type: 'toggle-listen', source: 'wakeword' });
    await flush();
    expect(controller.state.audioPhase).toBe('LISTENING');
    jarvis.command({ type: 'toggle-listen', source: 'wakeword' });
    await flush();
    expect(audio.mic.stopCalls).toBe(0);
    expect(controller.state.audioPhase).toBe('LISTENING');
  });

  it('a wakeword command is ignored when the wake word is disabled (mock)', async () => {
    const { audio, jarvis } = await setup();
    jarvis.command({ type: 'toggle-listen', source: 'wakeword' });
    await flush();
    expect(audio.mic.startCalls).toHaveLength(0);
  });

  it('changing wake settings restarts the detector; disabling stops it (mock)', async () => {
    const { audio, controller } = await setup({ settings: wakeOn() });
    await controller.updateSettings({ wakeWord: { sensitivity: 0.8 } });
    await flush();
    expect(audio.wakeDetectors).toHaveLength(2);
    expect(audio.wakeDetectors[0]?.stopCalls).toBe(1);
    expect(audio.wakeDetectors[1]?.startOptions?.sensitivity).toBe(0.8);
    await controller.updateSettings({ wakeWord: { enabled: false } });
    await flush();
    expect(audio.wakeDetectors[1]?.stopCalls).toBe(1);
    expect(controller.state.wake.status).toBe('off');
  });
});

describe('JarvisController — events, commands, approvals (mock)', () => {
  const approval = (id: string): ApprovalRequest => ({
    approvalId: id,
    turnId: 't1',
    actionId: 'a1',
    tool: 'capture_screen_for_analysis',
    action_he: 'צילום מסך',
    target_he: 'מסך ראשי',
    impact_he: 'התמונה תישלח לניתוח',
    reason: 'privacy',
    expiresAt: '2026-10-05T09:01:00.000Z',
  });
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

  it('applies the snapshot: pending approvals and missed reminders (mock)', async () => {
    const jarvis = mockJarvisApi();
    jarvis.snapshot = { phase: 'AWAITING_APPROVAL', activeTurnId: 't1', pendingApprovals: [approval('ap1')], missedReminders: [reminder('r1')] };
    const audio = mockAudio();
    const clock = mockClock();
    const controller = new JarvisController({ api: jarvis.api, audio: audio.factories, now: clock.now, timers: clock.timers, randomId: () => 'x' });
    await controller.init();
    expect(controller.state.pendingApprovals.map((a) => a.approvalId)).toEqual(['ap1']);
    expect(controller.state.missedReminders.map((r) => r.id)).toEqual(['r1']);
    expect(displayState(controller)).toBe('AWAITING_APPROVAL');
  });

  it('approve sends the decision with the chosen display and removes the request (mock)', async () => {
    const { jarvis, controller } = await setup();
    jarvis.emit({ type: 'approval-required', request: approval('ap2') });
    expect(controller.state.pendingApprovals).toHaveLength(1);
    const res = await controller.decideApproval('ap2', true, 'display-2');
    expect(res.ok).toBe(true);
    expect(jarvis.api.assistant.approve).toHaveBeenCalledWith({ approvalId: 'ap2', approved: true, displayId: 'display-2' });
    expect(controller.state.pendingApprovals).toHaveLength(0);
  });

  it('approval-resolved removes the request; expired shows a notice (mock)', async () => {
    const { jarvis, controller } = await setup();
    jarvis.emit({ type: 'approval-required', request: approval('ap3') });
    jarvis.emit({ type: 'approval-resolved', approvalId: 'ap3', outcome: 'expired' });
    expect(controller.state.pendingApprovals).toHaveLength(0);
    expect(toastTexts(controller)).toContain(he.toasts.approvalExpired);
  });

  it('actions are upserted by id and response actions are merged (mock)', async () => {
    const { jarvis, controller } = await setup();
    const base = { id: 'act1', turnId: 't1', tool: 'open_application', title: 'פתיחת תוכנה: EPLAN', verified: false, startedAt: '2026-10-05T09:00:00Z' };
    jarvis.emit({ type: 'action', action: { ...base, status: 'running' } });
    jarvis.emit({ type: 'response', turnId: 't1', text: 'EPLAN נפתח.', speak: false, mode: 'ai', actions: [{ ...base, status: 'succeeded', verified: true }] });
    expect(controller.state.actions).toHaveLength(1);
    expect(controller.state.actions[0]).toMatchObject({ status: 'succeeded', verified: true });
    expect(controller.state.lastReply?.text).toBe('EPLAN נפתח.');
  });

  it('acknowledging missed reminders calls data.acknowledgeReminders and clears the banner (mock)', async () => {
    const { jarvis, controller } = await setup();
    jarvis.emit({ type: 'missed-reminders', reminders: [reminder('r1'), reminder('r2')] });
    expect(controller.state.missedReminders).toHaveLength(2);
    expect(await controller.acknowledgeMissedReminders()).toBe(true);
    expect(jarvis.api.data.acknowledgeReminders).toHaveBeenCalledWith(['r1', 'r2']);
    expect(controller.state.missedReminders).toHaveLength(0);
  });

  it('view-mode command switches the window and persists the mode (mock)', async () => {
    const { jarvis, controller } = await setup();
    jarvis.command({ type: 'view-mode', mode: 'compact' });
    await flush();
    expect(jarvis.api.window.setMode).toHaveBeenCalledWith('compact');
    expect(jarvis.api.settings.update).toHaveBeenCalledWith({ ui: { mode: 'compact' } });
    expect(controller.state.viewMode).toBe('compact');
  });

  it('an approval in compact mode expands temporarily and restores compact afterwards (mock)', async () => {
    const { jarvis, controller } = await setup({ settings: settingsWith((s) => (s.ui.mode = 'compact')) });
    expect(controller.state.viewMode).toBe('compact');
    jarvis.emit({ type: 'approval-required', request: approval('ap9') });
    await flush();
    expect(controller.state.viewMode).toBe('full');
    expect(jarvis.api.settings.update).not.toHaveBeenCalled();
    await controller.decideApproval('ap9', false);
    await flush();
    expect(controller.state.viewMode).toBe('compact');
  });

  it('open-settings command opens the settings overlay (mock)', async () => {
    const { jarvis, controller } = await setup();
    jarvis.command({ type: 'open-settings' });
    expect(controller.state.settingsOpen).toBe(true);
  });

  it('screen-capture stages are shown and the final stage clears itself (mock)', async () => {
    const { jarvis, clock, controller } = await setup();
    jarvis.emit({ type: 'screen-capture', stage: 'capturing', displayLabel: 'מסך 1' });
    expect(controller.state.screenCapture).toEqual({ stage: 'capturing', displayLabel: 'מסך 1' });
    jarvis.emit({ type: 'screen-capture', stage: 'discarded' });
    clock.advance(4000);
    expect(controller.state.screenCapture).toBeNull();
  });

  it('data-changed settings reloads settings from main (mock)', async () => {
    const { jarvis, controller } = await setup();
    jarvis.settings = settingsWith((s) => (s.profile.userName = 'טוני'));
    jarvis.emit({ type: 'data-changed', scope: 'settings' });
    await flush();
    expect(controller.state.settings?.profile.userName).toBe('טוני');
    expect(controller.state.dataVersion.settings).toBe(1);
  });
});

describe('JarvisController — lifecycle (mock)', () => {
  it('reports battery and removes the listeners on dispose (mock)', async () => {
    const listeners = new Map<string, () => void>();
    const battery: BatteryLike = {
      level: 0.42,
      charging: false,
      chargingTime: Number.POSITIVE_INFINITY,
      dischargingTime: 7200,
      addEventListener: (type, l) => listeners.set(type, l),
      removeEventListener: (type) => listeners.delete(type),
    };
    const { jarvis, controller } = await setup({ battery });
    expect(jarvis.api.system.reportBattery).toHaveBeenCalledWith({ level: 0.42, charging: false, chargingTime: null, dischargingTime: 7200 });
    expect([...listeners.keys()].sort()).toEqual(['chargingchange', 'levelchange']);
    controller.dispose();
    expect(listeners.size).toBe(0);
  });

  it('dispose unsubscribes, cancels the mic and clears timers (mock)', async () => {
    const { jarvis, audio, clock, controller } = await setup({
      settings: settingsWith((s) => (s.wakeWord.enabled = true)),
    });
    await controller.toggleListen('ui');
    controller.notify('info', 'הודעה');
    controller.dispose();
    expect(jarvis.eventListenerCount()).toBe(0);
    expect(jarvis.commandListenerCount()).toBe(0);
    expect(audio.mic.cancelCalls).toBe(1);
    expect(audio.wakeDetectors[0]?.stopCalls).toBe(1);
    expect(clock.pending()).toBe(0);
  });

  it('toasts auto-dismiss, sticky ones stay, duplicates are collapsed (mock)', async () => {
    const { clock, controller } = await setup();
    controller.notify('info', 'א');
    controller.notify('info', 'א');
    controller.notify('warning', 'ב', { sticky: true });
    expect(toastTexts(controller)).toEqual(['א', 'ב']);
    clock.advance(6000);
    expect(toastTexts(controller)).toEqual(['ב']);
  });
});
