import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { uuidV4 } from '../../../src/renderer/state/ids';
import { AppEntrySchema, defaultLauncher, ProjectEntrySchema } from '../../../src/shared/settings-schema';
import { aiChip, micChip, wakeChip } from '../../../src/renderer/state/chips';
import { isMicErrorLike, micErrorMessage } from '../../../src/renderer/state/messages';
import { splitForSynthesis } from '../../../src/renderer/state/speech-text';
import { createStore } from '../../../src/renderer/state/store';
import {
  addAlias,
  appKindFromPath,
  findMatchingApp,
  ID_RE,
  isHebrewVoice,
  makeUniqueId,
  MODEL_ID_RE,
  newCustomApp,
  newProject,
  parseIntInRange,
  partitionVoices,
  removeAlias,
  secretStatusText,
} from '../../../src/renderer/settings/helpers';
import { defaultSettings } from '../../../src/shared/settings-schema';

describe('settings helpers', () => {
  it('makeUniqueId produces schema-valid unique ids', () => {
    expect(makeUniqueId('Google Chrome', [], 'app')).toBe('google-chrome');
    expect(makeUniqueId('Google Chrome', ['google-chrome'], 'app')).toBe('google-chrome-2');
    expect(makeUniqueId('כרום', [], 'app')).toBe('app-1');
    expect(makeUniqueId('כרום', ['app-1'], 'app')).toBe('app-2');
    for (const id of [makeUniqueId('!!!', [], 'project'), makeUniqueId('A'.repeat(80), [], 'app')]) {
      expect(ID_RE.test(id)).toBe(true);
    }
  });

  it('new entries pass the settings schema', () => {
    const { apps, projects } = defaultLauncher();
    expect(AppEntrySchema.safeParse(newCustomApp(apps)).success).toBe(true);
    expect(ProjectEntrySchema.safeParse(newProject(projects)).success).toBe(true);
    expect(apps.map((a) => a.id)).not.toContain(newCustomApp(apps).id);
  });

  it('aliases: trim, dedupe case-insensitively, max 20', () => {
    expect(addAlias(['EPLAN'], '  eplan ', 60)).toEqual(['EPLAN']);
    expect(addAlias([], '  אי   פלאן ', 60)).toEqual(['אי פלאן']);
    expect(addAlias([], '   ', 60)).toEqual([]);
    const twenty = Array.from({ length: 20 }, (_, i) => `a${i}`);
    expect(addAlias(twenty, 'new', 60)).toHaveLength(20);
    expect(removeAlias(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('app kind from a picked Windows path', () => {
    expect(appKindFromPath('C:\\Program Files\\EPLAN\\Platform\\Bin\\EPLAN.EXE')).toBe('exe');
    expect(appKindFromPath('C:\\Users\\ori\\Desktop\\Spotify.lnk')).toBe('shortcut');
    expect(appKindFromPath('C:\\x\\site.url')).toBe('shortcut');
    expect(appKindFromPath('C:\\x\\readme.txt')).toBeNull();
  });

  it('matches detected apps to existing entries by id or name', () => {
    const { apps } = defaultLauncher();
    expect(findMatchingApp(apps, { name: 'EPLAN', suggestedId: 'eplan-p8' })?.id).toBe('eplan');
    expect(findMatchingApp(apps, { name: 'Other', suggestedId: 'spotify' })?.id).toBe('spotify');
    expect(findMatchingApp(apps, { name: 'Zoom', suggestedId: 'zoom' })).toBeUndefined();
  });

  it('Hebrew system voices are detected and listed first', () => {
    expect(isHebrewVoice({ name: 'Microsoft Asaf', lang: 'he-IL' })).toBe(true);
    expect(isHebrewVoice({ name: 'Old', lang: 'iw-IL' })).toBe(true);
    expect(isHebrewVoice({ name: 'Microsoft David', lang: 'en-US' })).toBe(false);
    const { hebrew, other } = partitionVoices([
      { name: 'Zira', lang: 'en-US' },
      { name: 'Asaf', lang: 'he-IL' },
    ]);
    expect(hebrew.map((v) => v.name)).toEqual(['Asaf']);
    expect(other.map((v) => v.name)).toEqual(['Zira']);
  });

  it('secret status never claims encryption unless stored securely', () => {
    expect(secretStatusText(undefined)).toBe('לא מוגדר');
    expect(secretStatusText({ name: 'anthropicApiKey', configured: true, source: 'secure-store' })).toBe('מוגדר ✓ (מוצפן ב-Windows)');
    expect(secretStatusText({ name: 'anthropicApiKey', configured: true, source: 'session' })).not.toContain('מוצפן ב-Windows');
    expect(secretStatusText({ name: 'anthropicApiKey', configured: false, source: 'none' })).toBe('לא מוגדר');
  });

  it('integer parsing within schema ranges', () => {
    expect(parseIntInRange('60', 10, 180)).toBe(60);
    expect(parseIntInRange(' 10 ', 10, 180)).toBe(10);
    expect(parseIntInRange('9', 10, 180)).toBeNull();
    expect(parseIntInRange('12.5', 10, 180)).toBeNull();
    expect(parseIntInRange('abc', 10, 180)).toBeNull();
  });

  it('model id pattern matches the schema', () => {
    expect(MODEL_ID_RE.test('claude-opus-5-5')).toBe(true);
    expect(MODEL_ID_RE.test('gpt-4o')).toBe(false);
    expect(MODEL_ID_RE.test('claude-Opus')).toBe(false);
  });
});

describe('status chips', () => {
  it('mic chip is red "מיקרופון פעיל" only while really listening', () => {
    expect(micChip({ audioPhase: 'LISTENING', micStarting: false, micTest: 'off' })).toMatchObject({ tone: 'red', text: 'מיקרופון פעיל' });
    expect(micChip({ audioPhase: 'IDLE', micStarting: true, micTest: 'off' }).tone).toBe('amber');
    expect(micChip({ audioPhase: 'TRANSCRIBING', micStarting: false, micTest: 'off' }).tone).toBe('dim');
    expect(micChip({ audioPhase: 'SPEAKING', micStarting: false, micTest: 'off' }).tone).toBe('dim');
    expect(micChip({ audioPhase: 'IDLE', micStarting: false, micTest: 'meter' }).tone).toBe('red');
  });

  it('wake chip shows local listening and hides when disabled', () => {
    expect(wakeChip({ status: 'off', error: null, engine: null })).toBeNull();
    expect(wakeChip({ status: 'listening', error: null, engine: 'openwakeword' })?.text).toBe('האזנה למילת הפעלה (מקומית)');
    expect(wakeChip({ status: 'error', error: 'x', engine: 'porcupine' })).toMatchObject({ tone: 'amber', title: 'x' });
  });

  it('AI chip reflects the reported llm service state', () => {
    const s = defaultSettings();
    expect(aiChip(s, []).tone).toBe('dim');
    expect(aiChip(s, [{ service: 'llm', provider: 'anthropic', configured: true, state: 'ok' }]).tone).toBe('green');
    expect(aiChip(s, [{ service: 'llm', provider: 'anthropic', configured: false, state: 'not_configured' }]).tone).toBe('amber');
    expect(aiChip(s, [{ service: 'llm', provider: 'anthropic', configured: true, state: 'error', lastError_he: 'מפתח לא תקין' }])).toMatchObject({
      tone: 'red',
      title: 'מפתח לא תקין',
    });
    const local = { ...s, ai: { ...s.ai, brainMode: 'local-only' as const } };
    expect(aiChip(local, [{ service: 'llm', provider: 'anthropic', configured: true, state: 'ok' }]).text).toBe('מצב מקומי (ללא ענן)');
  });
});

describe('mic error messages', () => {
  it('permission denied always points to Windows privacy settings', () => {
    const err = Object.assign(new Error('denied'), { name: 'MicError', kind: 'permission-denied' });
    expect(isMicErrorLike(err)).toBe(true);
    expect(micErrorMessage(err)).toContain('פרטיות ואבטחה ← מיקרופון');
  });
  it('prefers the specific Hebrew message from the audio layer', () => {
    const err = Object.assign(new Error('המיקרופון שנבחר בהגדרות לא נמצא.'), { name: 'MicError', kind: 'no-device' });
    expect(micErrorMessage(err)).toBe('המיקרופון שנבחר בהגדרות לא נמצא.');
  });
  it('falls back to kind-based guidance for non-Hebrew messages', () => {
    const err = Object.assign(new Error('NotReadableError'), { name: 'MicError', kind: 'device-busy' });
    expect(micErrorMessage(err)).toContain('תפוס');
    expect(micErrorMessage(new Error('boom'))).toContain('boom');
  });
});

describe('speech text splitting', () => {
  it('short text stays one chunk; whitespace is normalized', () => {
    expect(splitForSynthesis('  שלום   עולם  ')).toEqual(['שלום עולם']);
    expect(splitForSynthesis('   ')).toEqual([]);
  });
  it('splits on sentence boundaries within the limit, without losing words', () => {
    const text = 'משפט ראשון. משפט שני! משפט שלישי? משפט רביעי.';
    const chunks = splitForSynthesis(text, 25);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(25);
    expect(chunks.join(' ').split(' ').filter(Boolean)).toEqual(text.split(' '));
  });
  it('splits very long sentences by words and hard-cuts unbroken tokens', () => {
    const long = `${'מילה '.repeat(40)}${'x'.repeat(30)}`;
    const chunks = splitForSynthesis(long, 20);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(20);
    expect(chunks.join('').replace(/\s/g, '')).toBe(long.replace(/\s/g, ''));
  });
});

describe('store', () => {
  it('notifies only on real changes and supports functional updates', () => {
    const store = createStore({ a: 1, b: 'x' });
    let calls = 0;
    const unsub = store.subscribe(() => calls++);
    store.setState({ a: 1 });
    expect(calls).toBe(0);
    store.setState((s) => ({ a: s.a + 1 }));
    expect(store.getState()).toEqual({ a: 2, b: 'x' });
    expect(calls).toBe(1);
    unsub();
    store.setState({ b: 'y' });
    expect(calls).toBe(1);
  });
});

describe('uuidV4', () => {
  it('uses crypto.randomUUID when available', () => {
    expect(uuidV4({ randomUUID: () => 'x', getRandomValues: (a) => a })).toBe('x');
  });
  it('falls back to getRandomValues and passes the IPC uuid schema (mock)', () => {
    // MOCK של crypto בלי randomUUID (כמו הקשר לא מאובטח)
    const fallback = { getRandomValues: <T extends ArrayBufferView | null>(a: T): T => webcrypto.getRandomValues(a as unknown as Uint8Array) as unknown as T };
    for (let i = 0; i < 50; i++) {
      const id = uuidV4(fallback);
      expect(z.string().uuid().safeParse(id).success).toBe(true);
      expect(id[14]).toBe('4');
    }
  });
});
