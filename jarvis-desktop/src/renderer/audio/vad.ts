/**
 * זיהוי פעילות קולית (VAD) מבוסס אנרגיה — מכונת מצבים טהורה ודטרמיניסטית.
 *
 * הקלט: מסגרות רצופות (בפועל 20ms) עם ערך RMS וזמן סיום המסגרת במילישניות של זמן אודיו
 * (מספר הדגימות שנקלטו / קצב הדגימה) — לא שעון קיר, כך שהבדיקות לא תלויות בזמן אמיתי.
 *
 * רצפת רעש אדפטיבית: המינימום של ה-RMS בחלון נע (ברירת מחדל 3 שניות). גם תוך כדי דיבור יש
 * רגעים שקטים (בין מילים, סגירת עיצורים), ולכן המינימום עוקב אחרי רעש הרקע ולא אחרי הדיבור,
 * ומתעדכן כלפי מעלה כשרעש הרקע משתנה (מאוורר שהופעל וכו').
 *
 * - תחילת דיבור: RMS ≥ max(רצפה·onsetRatio, minSpeechRms) במשך onsetFrames מסגרות רצופות.
 * - המשך דיבור (היסטרזיס): RMS ≥ max(רצפה·continueRatio, ...) — סף נמוך יותר, כדי שסוף מילה שקט לא ייחשב שקט.
 * - סוף: silenceTimeoutMs של שקט רצוף אחרי שהדיבור התחיל. קפיצה בודדת (הקלקה) לא מאפסת את השקט —
 *   צריך resumeFrames מסגרות קוליות רצופות.
 * - בלי דיבור בכלל: אחרי noSpeechTimeoutMs (6 שניות) -> 'silence' עם speechDetected=false.
 * - תקרה: maxUtteranceMs מתחילת ההקלטה -> 'max-duration'.
 */

export interface VadOptions {
  silenceTimeoutMs: number;
  maxUtteranceMs: number;
  /** כמה זמן לחכות לדיבור לפני שמוותרים. ברירת מחדל 6000. */
  noSpeechTimeoutMs?: number;
  /** פי כמה מעל רצפת הרעש נחשב תחילת דיבור. ברירת מחדל 3 (≈ ‎+9.5dB). */
  onsetRatio?: number;
  /** פי כמה מעל רצפת הרעש נחשב המשך דיבור. ברירת מחדל 2 (≈ ‎+6dB). */
  continueRatio?: number;
  /** סף מוחלט מינימלי לתחילת דיבור (≈ ‎-42dBFS), כדי שרעש דיגיטלי זעיר לא ייחשב דיבור. */
  minSpeechRms?: number;
  /** מספר מסגרות רצופות מעל הסף לתחילת דיבור. ברירת מחדל 4 (80ms במסגרות של 20ms). */
  onsetFrames?: number;
  /** מספר מסגרות קוליות רצופות שמבטלות שקט שכבר התחיל. ברירת מחדל 2. */
  resumeFrames?: number;
  /** אורך החלון למעקב אחרי רצפת הרעש. ברירת מחדל 3000ms. */
  floorWindowMs?: number;
}

export type VadEndReason = 'silence' | 'max-duration';

export type VadEvent =
  | { type: 'speech-start'; atMs: number }
  | {
      type: 'end';
      reason: VadEndReason;
      speechDetected: boolean;
      atMs: number;
      /** סוף המסגרת הקולית האחרונה שאושרה, או null אם לא זוהה דיבור. */
      lastVoiceMs: number | null;
    };

export type VadState = 'waiting' | 'speaking' | 'ended';

export interface Vad {
  /** מזין מסגרת. מחזיר אירוע כשמשהו השתנה, אחרת null. אחרי 'end' — תמיד null. */
  push(rms: number, endMs: number): VadEvent | null;
  readonly state: VadState;
  readonly speechDetected: boolean;
  readonly noiseFloor: number;
  readonly lastVoiceMs: number | null;
}

export const NO_SPEECH_TIMEOUT_MS = 6_000;

/** מסגרות עם RMS מתחת לזה הן אפסים דיגיטליים (למשל בפתיחת המיקרופון) — לא מלמדים מהן על רעש הרקע. */
const DIGITAL_SILENCE_RMS = 1e-5;
/** רצפה מינימלית, כדי שהכפלה ביחס לא תיתן סף אפס. */
const MIN_NOISE_FLOOR = 1e-4;

export function createVad(options: VadOptions): Vad {
  const silenceTimeoutMs = positive(options.silenceTimeoutMs, 1_300);
  const maxUtteranceMs = positive(options.maxUtteranceMs, 15_000);
  const noSpeechTimeoutMs = positive(options.noSpeechTimeoutMs, NO_SPEECH_TIMEOUT_MS);
  const onsetRatio = positive(options.onsetRatio, 3);
  const continueRatio = Math.min(onsetRatio, positive(options.continueRatio, 2));
  const minSpeechRms = positive(options.minSpeechRms, 0.008);
  const minContinueRms = (minSpeechRms * continueRatio) / onsetRatio;
  const onsetFrames = Math.max(1, Math.round(positive(options.onsetFrames, 4)));
  const resumeFrames = Math.max(1, Math.round(positive(options.resumeFrames, 2)));
  const floorWindowMs = positive(options.floorWindowMs, 3_000);

  let state: VadState = 'waiting';
  let speechDetected = false;
  let lastEndMs = 0;
  let floor = MIN_NOISE_FLOOR;
  /** היסטוריית RMS לחלון רצפת הרעש. לכל היותר ~150 מסגרות, כך שסריקה ליניארית זולה. */
  const history: Array<{ endMs: number; rms: number }> = [];

  let onsetRun = 0;
  let voicedRun = 0;
  let silenceStartMs: number | null = null;
  let lastVoiceMs: number | null = null;

  function updateFloor(rms: number, endMs: number): void {
    if (rms > DIGITAL_SILENCE_RMS) history.push({ endMs, rms });
    while (history.length > 0 && (history[0]?.endMs ?? 0) <= endMs - floorWindowMs) history.shift();
    if (history.length === 0) return; // אין מידע חדש — שומרים את הרצפה האחרונה
    let min = Infinity;
    for (const h of history) if (h.rms < min) min = h.rms;
    floor = Math.max(MIN_NOISE_FLOOR, min);
  }

  function end(reason: VadEndReason, atMs: number): VadEvent {
    state = 'ended';
    return { type: 'end', reason, speechDetected, atMs, lastVoiceMs: speechDetected ? lastVoiceMs : null };
  }

  return {
    get state() {
      return state;
    },
    get speechDetected() {
      return speechDetected;
    },
    get noiseFloor() {
      return floor;
    },
    get lastVoiceMs() {
      return lastVoiceMs;
    },
    push(rawRms: number, rawEndMs: number): VadEvent | null {
      if (state === 'ended') return null;
      const rms = Number.isFinite(rawRms) && rawRms > 0 ? rawRms : 0;
      const frameStartMs = lastEndMs;
      const endMs = Number.isFinite(rawEndMs) ? Math.max(rawEndMs, lastEndMs) : lastEndMs;
      lastEndMs = endMs;

      updateFloor(rms, endMs);
      let event: VadEvent | null = null;

      if (state === 'waiting') {
        const onsetThreshold = Math.max(floor * onsetRatio, minSpeechRms);
        if (rms >= onsetThreshold) {
          onsetRun++;
          if (onsetRun >= onsetFrames) {
            state = 'speaking';
            speechDetected = true;
            lastVoiceMs = endMs;
            silenceStartMs = null;
            voicedRun = onsetRun;
            event = { type: 'speech-start', atMs: endMs };
          }
        } else {
          onsetRun = 0;
        }
      } else {
        const continueThreshold = Math.max(floor * continueRatio, minContinueRms);
        if (rms >= continueThreshold) {
          voicedRun++;
          if (silenceStartMs === null || voicedRun >= resumeFrames) {
            silenceStartMs = null;
            lastVoiceMs = endMs;
          }
        } else {
          voicedRun = 0;
          if (silenceStartMs === null) silenceStartMs = frameStartMs;
        }
        if (silenceStartMs !== null && endMs - silenceStartMs >= silenceTimeoutMs) {
          return end('silence', endMs);
        }
      }

      if (endMs >= maxUtteranceMs) return end('max-duration', endMs);
      if (state === 'waiting' && endMs >= noSpeechTimeoutMs) return end('silence', endMs);
      return event;
    },
  };
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
