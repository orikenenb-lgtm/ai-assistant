import { describe, expect, it } from 'vitest';
import { he, providerName } from '../../../src/renderer/i18n/he';
import { compactWakeChip } from '../../../src/renderer/state/chips';
import { ipcErrorMessage, isUserFacingHebrew, stripIpcPrefix, userFacingHebrew } from '../../../src/renderer/state/messages';
import { splitForSynthesis, splitSentences } from '../../../src/renderer/state/speech-text';

describe('TTS chunker — review fixes', () => {
  it('after an over-long sentence is split by words, the next sentence keeps its space', () => {
    const longSentence = `${Array.from({ length: 400 }, () => 'מילה').join(' ')} סוף.`;
    const chunks = splitForSynthesis(`${longSentence} משפט הבא כאן.`);
    expect(chunks.every((c) => c.length <= 1500)).toBe(true);
    const joined = chunks.join(' ');
    expect(joined).toContain('סוף. משפט');
    expect(joined).not.toContain('סוף.משפט');
  });

  it('a time like 10:30 or a decimal is never split at the punctuation', () => {
    const filler = `${'א'.repeat(1488)}.`;
    const chunks = splitForSynthesis(`${filler} השעה 10:30 בבוקר, הטמפרטורה 3.5 מעלות.`);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toBe('השעה 10:30 בבוקר, הטמפרטורה 3.5 מעלות.');
    expect(splitSentences('השעה 10:30. ומה עוד?')).toEqual(['השעה 10:30. ', 'ומה עוד?']);
  });

  it('leading punctuation is kept', () => {
    const text = `... ${'שלום עולם. '.repeat(200)}`;
    const chunks = splitForSynthesis(text);
    expect(chunks[0]!.startsWith('...')).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' ').trim());
  });
});

describe('Hebrew-only messages', () => {
  it('strips the Electron IPC prefix and keeps Hebrew messages', () => {
    const raw = "Error invoking remote method 'wakeword:start': Error: המודל לא נטען";
    expect(stripIpcPrefix(raw)).toBe('המודל לא נטען');
    expect(userFacingHebrew(raw)).toBe('המודל לא נטען');
    expect(ipcErrorMessage(new Error(raw))).toBe('המודל לא נטען');
  });

  it('technical English (even with a Hebrew word in it) maps to the generic Hebrew text', () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'voice:transcribe': Error: INVALID_PARAMS"))).toBe(he.errors.ipc);
    expect(isUserFacingHebrew('RuntimeError: memory access out of bounds (שגיאה)')).toBe(false);
    expect(isUserFacingHebrew('המודל לא נטען: RuntimeError: Aborted(CompileError: WebAssembly.instantiate(): expected magic word)')).toBe(false);
    expect(userFacingHebrew('no available backend found. ERR: [wasm] TypeError')).toBeNull();
  });

  it('Hebrew sentences with product names stay user-facing', () => {
    expect(isUserFacingHebrew('כדי להשתמש במילה "Jarvis" צריך AccessKey חינמי של Picovoice. הוסף אותו בהגדרות ← מילת הפעלה.')).toBe(true);
    expect(
      isUserFacingHebrew(
        'מנוע Porcupine דורש את Microsoft Visual C++ Redistributable (2015–2022, x64). התקן אותו מאתר Microsoft והפעל מחדש את JARVIS. מילת ההפעלה "Hey Jarvis" (openWakeWord) עובדת גם בלעדיו.',
      ),
    ).toBe(true);
  });

  it('provider ids are shown by name', () => {
    expect(providerName('local-openai-compatible')).toBe('שרת תמלול מקומי');
    expect(providerName('system')).toBe('קול המערכת');
    expect(providerName('claude-opus-5-5')).toBe('claude-opus-5-5');
  });
});

describe('compact wake-word chip', () => {
  it('shows only when the mic is open locally for the wake word, or on error', () => {
    expect(compactWakeChip({ status: 'listening', error: null, engine: 'openwakeword' })).toMatchObject({ tone: 'cyan', text: 'מאזין למילת הפעלה (מקומית)' });
    expect(compactWakeChip({ status: 'paused', error: null, engine: 'openwakeword' })).toBeNull();
    expect(compactWakeChip({ status: 'off', error: null, engine: null })).toBeNull();
    const err = compactWakeChip({ status: 'error', error: 'מילת ההפעלה לא זמינה: אין מיקרופון.', engine: 'porcupine' });
    expect(err).toMatchObject({ tone: 'amber', text: he.compact.wakeError });
    expect(err?.title).toContain('לחץ כדי לנסות שוב');
  });
});
