import { describe, expect, it } from 'vitest';
import {
  createSystemSpeakerWith,
  pickVoice,
  speakWatchdogMs,
  VOICES_TIMEOUT_MS,
} from '../../../src/renderer/audio/system-speaker';
import { flush, mockTimers, MockSynth, MockUtterance, mockVoice } from './audio.mock';

const ASAF = mockVoice('Microsoft Asaf - Hebrew (Israel)', 'he-IL');
const DAVID = mockVoice('Microsoft David - English (United States)', 'en-US');
const ZIRA = mockVoice('Microsoft Zira - English (United States)', 'en-US');

function setup(voices = [DAVID, ASAF, ZIRA]) {
  const timers = mockTimers();
  const synth = new MockSynth();
  synth.voices = voices;
  const speaker = createSystemSpeakerWith({
    synth: synth as unknown as SpeechSynthesis,
    createUtterance: (text) => new MockUtterance(text) as unknown as SpeechSynthesisUtterance,
    timers,
  });
  return { speaker, synth, timers };
}

describe('pickVoice', () => {
  it('prefers the requested voice, then the first local Hebrew voice', () => {
    const online = mockVoice('Hebrew Online', 'he-IL', false);
    expect(pickVoice([DAVID, online, ASAF], undefined, 'שלום')).toBe(ASAF);
    expect(pickVoice([DAVID, online], undefined, 'שלום')).toBe(online);
    expect(pickVoice([DAVID, ASAF], ASAF.name, 'שלום')).toBe(ASAF);
  });

  it('never reads Hebrew text with a non-Hebrew voice', () => {
    expect(pickVoice([DAVID, ZIRA], undefined, 'שלום')).toBeNull();
    // בחירה מפורשת בקול אנגלי — מכובדת רק לטקסט בלי עברית
    expect(pickVoice([DAVID, ASAF], DAVID.name, 'הפגישה נקבעה')).toBe(ASAF);
    expect(pickVoice([DAVID, ASAF], DAVID.name, 'Meeting scheduled')).toBe(DAVID);
  });

  it("accepts legacy 'iw' and bare 'he' language codes", () => {
    const legacy = mockVoice('Legacy Hebrew', 'iw-IL');
    const bare = mockVoice('Bare Hebrew', 'he');
    expect(pickVoice([DAVID, legacy], undefined, 'שלום')).toBe(legacy);
    expect(pickVoice([DAVID, bare], undefined, 'שלום')).toBe(bare);
    expect(pickVoice([mockVoice('Herero', 'hz-NA')], undefined, 'שלום')).toBeNull();
  });

  it('gives a generous watchdog that grows with text length and slower rates', () => {
    expect(speakWatchdogMs('קצר', 1)).toBe(15_000);
    expect(speakWatchdogMs('א'.repeat(1_000), 1)).toBe(210_000);
    expect(speakWatchdogMs('א'.repeat(1_000), 0.5)).toBe(410_000);
  });
});

describe('createSystemSpeakerWith (mock)', () => {
  it('speaks with the first Hebrew voice, its lang and the clamped rate (mock)', async () => {
    const { speaker, synth } = setup();
    const speaking = speaker.speak('  פתחתי את ספוטיפיי  ', { rate: 3 });
    await flush();
    expect(speaker.speaking).toBe(true);
    const u = synth.spoken[0]!;
    expect(u.text).toBe('פתחתי את ספוטיפיי');
    expect(u.voice).toBe(ASAF);
    expect(u.lang).toBe('he-IL');
    expect(u.rate).toBe(2);
    synth.finishCurrent();
    await expect(speaking).resolves.toBe('ended');
    expect(speaker.speaking).toBe(false);
  });

  it("returns 'no-voice' and speaks nothing when there is no Hebrew voice (mock)", async () => {
    const { speaker, synth } = setup([DAVID, ZIRA]);
    await expect(speaker.speak('שלום אורי', { rate: 1 })).resolves.toBe('no-voice');
    expect(synth.spoken).toHaveLength(0);
    expect(speaker.speaking).toBe(false);
  });

  it("returns 'no-voice' when speechSynthesis is unavailable (mock)", async () => {
    const speaker = createSystemSpeakerWith({ synth: null, createUtterance: null, timers: mockTimers() });
    await expect(speaker.speak('שלום', { rate: 1 })).resolves.toBe('no-voice');
    await expect(speaker.listVoices()).resolves.toEqual([]);
  });

  it("stop() resolves 'stopped' immediately and cancels synthesis (mock)", async () => {
    const { speaker, synth } = setup();
    const speaking = speaker.speak('משפט ארוך', { rate: 1 });
    await flush();
    speaker.stop();
    expect(speaker.speaking).toBe(false);
    await expect(speaking).resolves.toBe('stopped');
    expect(synth.cancelCalls).toBe(1);
  });

  it("a new speak() interrupts the current one, which resolves 'stopped' (mock)", async () => {
    const { speaker, synth } = setup();
    const first = speaker.speak('ראשון', { rate: 1 });
    await flush();
    const second = speaker.speak('שני', { rate: 1 });
    await expect(first).resolves.toBe('stopped');
    await flush();
    expect(synth.spoken.map((u) => u.text)).toEqual(['ראשון', 'שני']);
    synth.finishCurrent();
    await expect(second).resolves.toBe('ended');
  });

  it("maps synthesis errors: language-unavailable -> 'no-voice', others -> 'stopped' (mock)", async () => {
    const { speaker, synth } = setup();
    const a = speaker.speak('א', { rate: 1 });
    await flush();
    synth.spoken[0]!.onerror?.({ error: 'language-unavailable' });
    await expect(a).resolves.toBe('no-voice');
    const b = speaker.speak('ב', { rate: 1 });
    await flush();
    synth.spoken[1]!.onerror?.({ error: 'synthesis-failed' });
    await expect(b).resolves.toBe('stopped');
  });

  it('waits for voiceschanged when the voice list is still empty (mock)', async () => {
    const { speaker, synth } = setup([]);
    const listing = speaker.listVoices();
    const speaking = speaker.speak('שלום', { rate: 1 });
    await flush();
    expect(synth.listenerCount).toBe(2);
    synth.loadVoices([ASAF]);
    await expect(listing).resolves.toEqual([{ name: ASAF.name, lang: 'he-IL', localService: true }]);
    await flush();
    expect(synth.listenerCount).toBe(0);
    expect(synth.spoken[0]!.voice).toBe(ASAF);
    synth.finishCurrent();
    await expect(speaking).resolves.toBe('ended');
  });

  it("gives up waiting for voices after the timeout and answers 'no-voice' (mock)", async () => {
    const { speaker, synth, timers } = setup([]);
    const listing = speaker.listVoices();
    const speaking = speaker.speak('שלום', { rate: 1 });
    timers.advance(VOICES_TIMEOUT_MS + 1);
    await expect(listing).resolves.toEqual([]);
    await expect(speaking).resolves.toBe('no-voice');
    expect(synth.listenerCount).toBe(0);
  });

  it("stop() while waiting for voices resolves 'stopped' immediately and never speaks (mock)", async () => {
    const { speaker, synth } = setup([]);
    const speaking = speaker.speak('שלום', { rate: 1 });
    await flush();
    speaker.stop();
    await expect(speaking).resolves.toBe('stopped');
    synth.loadVoices([ASAF]);
    await flush();
    expect(synth.spoken).toHaveLength(0);
  });

  it("resolves 'stopped' via the watchdog if onend never fires (mock)", async () => {
    const { speaker, synth, timers } = setup();
    const speaking = speaker.speak('שלום', { rate: 1 });
    await flush();
    timers.advance(speakWatchdogMs('שלום', 1) + 1);
    await expect(speaking).resolves.toBe('stopped');
    expect(synth.cancelCalls).toBe(1);
  });

  it("resolves 'ended' for empty text without speaking (mock)", async () => {
    const { speaker, synth } = setup();
    await expect(speaker.speak('   ', { rate: 1 })).resolves.toBe('ended');
    expect(synth.spoken).toHaveLength(0);
  });
});
