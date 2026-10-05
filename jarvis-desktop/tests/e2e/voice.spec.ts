import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { fixture, fixtureBase64, installMockFetch, launchJarvis, mockCalls, mockClaudeMessage } from './helpers';

/**
 * מסלול קולי מקצה לקצה עם מיקרופון מדומה של Chromium (--use-file-for-fake-audio-capture):
 * קובץ WAV אמיתי (עברית מסונתזת) עובר דרך getUserMedia → AudioWorklet → VAD → WAV → IPC → תמלול.
 * ⚠ MOCK: רק שירותי הענן (OpenAI לתמלול, Claude, Azure להקראה) מוחלפים בתסריט. ההשמעה, המצבים וה-HUD אמיתיים.
 */

async function recordStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __states: string[] };
    w.__states = [];
    const root = document.querySelector('.app');
    const push = () => {
      const st = root?.getAttribute('data-state') ?? '?';
      if (w.__states[w.__states.length - 1] !== st) w.__states.push(st);
    };
    push();
    if (root) new MutationObserver(push).observe(root, { attributes: true, attributeFilter: ['data-state'] });
  });
}

async function states(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __states: string[] }).__states);
}

async function sendCommand(app: ElectronApplication, command: unknown): Promise<void> {
  await app.evaluate(({ BrowserWindow }, cmd) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('evt:command', cmd);
  }, command);
}

async function configureVoice(page: Page, ttsAudio: 'short' | 'long'): Promise<void> {
  const res = await page.evaluate(async () => {
    const s = await window.jarvis.settings.get();
    return window.jarvis.settings.update({
      stt: { ...s.stt, provider: 'openai' },
      tts: { ...s.tts, provider: 'azure', autoSpeak: true },
      azure: { region: 'westeurope' },
    });
  });
  expect(res.ok).toBe(true);
  for (const [name, value] of [
    ['anthropicApiKey', 'sk-ant-e2e-mock-key-000000'],
    ['openaiApiKey', 'sk-openai-e2e-mock-0000000'],
    ['azureSpeechKey', 'azure-e2e-mock-key-00000'],
  ] as const) {
    const r = await page.evaluate(([n, v]) => window.jarvis.secrets.set(n, v), [name, value] as const);
    expect(r.ok).toBe(true);
  }
  void ttsAudio;
}

async function spyOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __openExternalCalls: string[] };
    g.__openExternalCalls = [];
    shell.openExternal = async (u: string) => {
      g.__openExternalCalls.push(u);
    };
  });
}

test('(mock cloud) push-to-talk: real mic capture → STT → Claude tool → verified action → spoken reply', async () => {
  const { app, page } = await launchJarvis({ fakeMicWav: fixture('audio', 'fake_mic_hebrew.wav') });
  try {
    await spyOpenExternal(app);
    await configureVoice(page, 'short');
    await installMockFetch(app, [
      { match: 'api.openai.com/v1/audio/transcriptions', responses: [{ json: { text: 'פתח Spotify' } }] },
      {
        match: 'api.anthropic.com/v1/messages',
        responses: [
          { json: mockClaudeMessage([{ type: 'tool_use', id: 'toolu_v', name: 'open_application', input: { app_id: 'spotify' } }], 'tool_use') },
          { json: mockClaudeMessage([{ type: 'text', text: 'פתחתי את Spotify.' }]) },
        ],
      },
      { match: 'tts.speech.microsoft.com', responses: [{ bodyBase64: fixtureBase64('audio', 'tone.mp3'), contentType: 'audio/mpeg' }] },
    ]);
    await recordStates(page);
    await sendCommand(app, { type: 'toggle-listen', source: 'hotkey' });

    // הסשן מסתיים כשחוזרים ל-IDLE אחרי שדיבר
    await expect
      .poll(async () => {
        const st = await states(page);
        const spoke = st.indexOf('SPEAKING');
        return spoke >= 0 && st.slice(spoke + 1).includes('IDLE');
      }, { timeout: 45_000 })
      .toBe(true);
    const seq = await states(page);
    // סדר המצבים משקף את מה שקרה בפועל
    const idx = (s: string) => seq.indexOf(s);
    expect(idx('LISTENING')).toBeGreaterThan(-1);
    expect(idx('THINKING')).toBeGreaterThan(idx('LISTENING'));
    expect(idx('SPEAKING')).toBeGreaterThan(idx('THINKING'));

    const calls = await mockCalls(app);
    const stt = calls.find((c) => c.url.includes('/audio/transcriptions'))!;
    const sttBody = stt.body as Record<string, string>;
    expect(sttBody.model).toBe('gpt-transcribe');
    const blobSize = Number(/\[blob (\d+)\]/.exec(sttBody.file ?? '')?.[1] ?? 0);
    expect(blobSize).toBeGreaterThan(16_000); // לפחות חצי שנייה של WAV 16kHz אמיתי מהמיקרופון
    const claude = calls.filter((c) => c.url.includes('/v1/messages'));
    expect(JSON.stringify(claude[0]!.body)).toContain('פתח Spotify');
    const tts = calls.find((c) => c.url.includes('tts.speech.microsoft.com'))!;
    expect(String(tts.body)).toContain('פתחתי את Spotify.');
    expect(String(tts.body)).toContain('he-IL-AvriNeural');
    expect(await app.evaluate(() => (globalThis as unknown as { __openExternalCalls: string[] }).__openExternalCalls)).toEqual(['spotify:']);
  } finally {
    await app.close();
  }
});

test('(mock cloud) pressing the mic while JARVIS speaks stops the speech and listens again', async () => {
  const { app, page } = await launchJarvis({ fakeMicWav: fixture('audio', 'fake_mic_hebrew.wav') });
  try {
    await configureVoice(page, 'long');
    await installMockFetch(app, [
      { match: 'api.openai.com/v1/audio/transcriptions', responses: [{ json: { text: 'מצב מערכת' } }] },
      { match: 'api.anthropic.com/v1/messages', responses: [{ json: mockClaudeMessage([{ type: 'text', text: 'הכול תקין. זו תשובה ארוכה לבדיקה.' }]) }] },
      { match: 'tts.speech.microsoft.com', responses: [{ bodyBase64: fixtureBase64('audio', 'tone_long.mp3'), contentType: 'audio/mpeg' }] },
    ]);
    await recordStates(page);
    // תור טקסט שמסתיים בהקראה ארוכה (8 שניות)
    await page.evaluate(() => window.jarvis.assistant.submit({ text: 'מצב מערכת', source: 'text', clientRequestId: crypto.randomUUID() }));
    await expect.poll(async () => (await states(page)).includes('SPEAKING'), { timeout: 30_000 }).toBe(true);
    const before = (await states(page)).length;
    await sendCommand(app, { type: 'toggle-listen', source: 'hotkey' });
    await expect.poll(async () => (await states(page)).slice(before).includes('LISTENING'), { timeout: 10_000 }).toBe(true);
    // העצירה: Esc / stop מחזיר ל-IDLE
    await sendCommand(app, { type: 'stop' });
    await expect.poll(async () => (await states(page)).at(-1), { timeout: 10_000 }).toBe('IDLE');
  } finally {
    await app.close();
  }
});

test('wake word: "Hey Jarvis" from the microphone starts listening (local openWakeWord, no network)', async () => {
  const { app, page } = await launchJarvis({ fakeMicWav: fixture('wakeword', 'hey_jarvis_espeak.wav') });
  try {
    await recordStates(page);
    const res = await page.evaluate(async () => {
      const s = await window.jarvis.settings.get();
      return window.jarvis.settings.update({ wakeWord: { ...s.wakeWord, enabled: true, engine: 'openwakeword', sensitivity: 0.5 } });
    });
    expect(res.ok).toBe(true);
    await expect.poll(async () => (await states(page)).includes('LISTENING'), { timeout: 30_000 }).toBe(true);
    // שום בקשת רשת לא יצאה בשביל מילת ההפעלה
    expect(await app.evaluate(() => (globalThis as unknown as { __jarvisMockCalls?: unknown[] }).__jarvisMockCalls ?? [])).toEqual([]);
  } finally {
    await app.close();
  }
});
