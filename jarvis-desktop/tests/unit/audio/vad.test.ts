import { describe, expect, it } from 'vitest';
import { createVad, NO_SPEECH_TIMEOUT_MS, type Vad, type VadEvent } from '../../../src/renderer/audio/vad';

const FRAME_MS = 20;
const NOISE = 0.002;
const SPEECH = 0.12;

type Segment = { ms: number; rms: number | ((frameIndex: number) => number) };

/** מזין מקטעים של מסגרות 20ms. מחזיר את האירועים עם הזמנים, ועוצר אחרי 'end'. */
function feed(vad: Vad, segments: Segment[], startMs = 0): { events: VadEvent[]; endMs: number } {
  const events: VadEvent[] = [];
  let t = startMs;
  for (const seg of segments) {
    const frames = Math.round(seg.ms / FRAME_MS);
    for (let i = 0; i < frames; i++) {
      t += FRAME_MS;
      const rms = typeof seg.rms === 'number' ? seg.rms : seg.rms(i);
      const event = vad.push(rms, t);
      if (event) events.push(event);
      if (event?.type === 'end') return { events, endMs: t };
    }
  }
  return { events, endMs: t };
}

/** דיבור עם הברות: מחזור של 240ms עם 40ms שקט ברמת רעש הרקע באמצעו; מקטע של 1200ms מסתיים בקול. */
const syllables = (frameIndex: number): number => (frameIndex % 12 === 8 || frameIndex % 12 === 9 ? NOISE : SPEECH);

function endOf(events: VadEvent[]): Extract<VadEvent, { type: 'end' }> {
  const end = events.find((e) => e.type === 'end');
  if (!end || end.type !== 'end') throw new Error('expected an end event');
  return end;
}

describe('createVad', () => {
  it('silence only: ends after 6 s with reason silence and no speech', () => {
    const vad = createVad({ silenceTimeoutMs: 1_300, maxUtteranceMs: 15_000 });
    const { events } = feed(vad, [{ ms: 10_000, rms: NOISE }]);
    expect(events).toHaveLength(1);
    const end = endOf(events);
    expect(end).toMatchObject({ reason: 'silence', speechDetected: false, atMs: NO_SPEECH_TIMEOUT_MS, lastVoiceMs: null });
    expect(vad.state).toBe('ended');
  });

  it('speech then silence: emits speech-start, then ends exactly silenceTimeoutMs after the last voiced frame', () => {
    const vad = createVad({ silenceTimeoutMs: 1_000, maxUtteranceMs: 15_000 });
    const { events } = feed(vad, [
      { ms: 500, rms: NOISE },
      { ms: 1_200, rms: syllables },
      { ms: 3_000, rms: NOISE },
    ]);
    const start = events.find((e) => e.type === 'speech-start');
    expect(start).toEqual({ type: 'speech-start', atMs: 500 + 4 * FRAME_MS });
    const end = endOf(events);
    expect(end.reason).toBe('silence');
    expect(end.speechDetected).toBe(true);
    expect(end.lastVoiceMs).toBe(1_700);
    expect(end.atMs).toBe(1_700 + 1_000);
  });

  it('max duration: stops continuous speech at maxUtteranceMs', () => {
    const vad = createVad({ silenceTimeoutMs: 1_300, maxUtteranceMs: 3_000 });
    const { events } = feed(vad, [
      { ms: 300, rms: NOISE },
      { ms: 10_000, rms: syllables },
    ]);
    const end = endOf(events);
    expect(end).toMatchObject({ reason: 'max-duration', speechDetected: true, atMs: 3_000 });
  });

  it('max duration shorter than the no-speech timeout ends with speechDetected=false', () => {
    const vad = createVad({ silenceTimeoutMs: 1_300, maxUtteranceMs: 3_000 });
    const end = endOf(feed(vad, [{ ms: 10_000, rms: NOISE }]).events);
    expect(end).toMatchObject({ reason: 'max-duration', speechDetected: false, atMs: 3_000 });
  });

  it('a short click (2 frames) is not speech', () => {
    const vad = createVad({ silenceTimeoutMs: 1_300, maxUtteranceMs: 15_000 });
    const { events } = feed(vad, [
      { ms: 400, rms: NOISE },
      { ms: 40, rms: 0.4 },
      { ms: 8_000, rms: NOISE },
    ]);
    expect(events.some((e) => e.type === 'speech-start')).toBe(false);
    expect(endOf(events)).toMatchObject({ reason: 'silence', speechDetected: false });
  });

  it('learns a steady noisy background as the floor and still detects speech above it', () => {
    const vad = createVad({ silenceTimeoutMs: 1_000, maxUtteranceMs: 15_000 });
    const fan = (i: number): number => (i % 2 === 0 ? 0.015 : 0.025); // מאוורר: רעש קבוע ותנודתי
    const before = feed(vad, [{ ms: 2_000, rms: fan }]);
    expect(before.events).toHaveLength(0);
    expect(vad.speechDetected).toBe(false);
    expect(vad.noiseFloor).toBeCloseTo(0.015, 5);
    const loudSyllables = (i: number): number => (i % 12 === 8 || i % 12 === 9 ? 0.02 : 0.2);
    const { events } = feed(
      vad,
      [
        { ms: 1_200, rms: loudSyllables },
        { ms: 3_000, rms: fan },
      ],
      before.endMs,
    );
    expect(events[0]?.type).toBe('speech-start');
    expect(endOf(events)).toMatchObject({ reason: 'silence', speechDetected: true, atMs: 2_000 + 1_200 + 1_000 });
  });

  it('a single spike during trailing silence does not restart the silence timer', () => {
    const vad = createVad({ silenceTimeoutMs: 1_000, maxUtteranceMs: 15_000 });
    const end = endOf(
      feed(vad, [
        { ms: 300, rms: NOISE },
        { ms: 1_200, rms: syllables },
        { ms: 400, rms: NOISE },
        { ms: 20, rms: 0.3 }, // הקלקת עכבר
        { ms: 3_000, rms: NOISE },
      ]).events,
    );
    expect(end.lastVoiceMs).toBe(1_500);
    expect(end.atMs).toBe(2_500);
  });

  it('resumed speech (2+ voiced frames) restarts the silence timer', () => {
    const vad = createVad({ silenceTimeoutMs: 1_000, maxUtteranceMs: 15_000 });
    const end = endOf(
      feed(vad, [
        { ms: 300, rms: NOISE },
        { ms: 1_200, rms: syllables },
        { ms: 800, rms: NOISE }, // הפסקה קצרה מ-silenceTimeout
        { ms: 400, rms: SPEECH },
        { ms: 3_000, rms: NOISE },
      ]).events,
    );
    expect(end.lastVoiceMs).toBe(2_700);
    expect(end.atMs).toBe(3_700);
    expect(end.reason).toBe('silence');
  });

  it('ignores digital-zero frames when the microphone opens', () => {
    const vad = createVad({ silenceTimeoutMs: 1_000, maxUtteranceMs: 15_000 });
    feed(vad, [
      { ms: 200, rms: 0 },
      { ms: 500, rms: NOISE },
    ]);
    expect(vad.noiseFloor).toBeCloseTo(NOISE, 6);
    expect(vad.speechDetected).toBe(false);
  });

  it('detects a user who is already talking when the mic opens (after the first pause)', () => {
    const vad = createVad({ silenceTimeoutMs: 1_000, maxUtteranceMs: 15_000 });
    const { events } = feed(vad, [
      { ms: 1_200, rms: syllables },
      { ms: 3_000, rms: NOISE },
    ]);
    expect(events.some((e) => e.type === 'speech-start')).toBe(true);
    expect(endOf(events)).toMatchObject({ reason: 'silence', speechDetected: true });
  });

  it('quiet speech below the absolute minimum is not speech', () => {
    const vad = createVad({ silenceTimeoutMs: 1_000, maxUtteranceMs: 15_000 });
    const { events } = feed(vad, [
      { ms: 500, rms: 0.0005 },
      { ms: 1_000, rms: 0.004 }, // פי 8 מהרצפה, אבל מתחת ל-‎-42dBFS
      { ms: 6_000, rms: 0.0005 },
    ]);
    expect(endOf(events)).toMatchObject({ reason: 'silence', speechDetected: false });
  });

  it('ignores frames after the end and tolerates bad input', () => {
    const vad = createVad({ silenceTimeoutMs: 1_000, maxUtteranceMs: 2_000 });
    expect(vad.push(Number.NaN, 20)).toBeNull();
    expect(vad.push(-1, 40)).toBeNull();
    const { events } = feed(vad, [{ ms: 5_000, rms: NOISE }], 40);
    expect(endOf(events).reason).toBe('max-duration');
    expect(vad.push(SPEECH, 99_999)).toBeNull();
    expect(vad.state).toBe('ended');
  });
});
