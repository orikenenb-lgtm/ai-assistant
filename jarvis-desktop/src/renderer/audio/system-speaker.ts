import { browserTimers, type AudioTimers, type TimerHandle } from './timers';
import type { SystemSpeaker, SystemVoiceInfo } from './types';

/**
 * הקראה בקול מערכת (Windows SAPI/OneCore דרך window.speechSynthesis), למשל "Microsoft Asaf".
 *
 * חשוב לממשק: במסלול הזה אין גישה לאות האודיו — Windows משמיע אותו ישירות, מחוץ ל-Web Audio.
 * לכן אין כאן getLevel/getWaveform, והממשק אסור שיצייר waveform מדומה בזמן הקראה במצב הזה.
 * (מאותה סיבה ביטול ההד של Chromium לא מכיר את הקול הזה — ראה echo.ts.)
 *
 * בחירת קול: הקול שהתבקש (אם הוא עברי, או אם הטקסט בלי עברית), אחרת הקול העברי המקומי הראשון,
 * אחרת הקול העברי הראשון, אחרת 'no-voice' — לעולם לא מקריאים עברית בקול אנגלי.
 */

export interface SystemSpeakerDeps {
  synth: SpeechSynthesis | null;
  createUtterance: ((text: string) => SpeechSynthesisUtterance) | null;
  timers: AudioTimers;
  /** כמה לחכות ל-voiceschanged כשרשימת הקולות עוד ריקה. ברירת מחדל 2000ms. */
  voicesTimeoutMs?: number;
}

export const VOICES_TIMEOUT_MS = 2_000;
const HEBREW_LANG = /^(he|iw)([-_]|$)/i;
const HEBREW_TEXT = /[֐-׿]/;

type SpeakOutcome = 'ended' | 'stopped' | 'no-voice';

interface SpeakJob {
  utterance: SpeechSynthesisUtterance;
  watchdog: TimerHandle | null;
  settle: (outcome: SpeakOutcome) => void;
}

export function isHebrewVoice(voice: Pick<SpeechSynthesisVoice, 'lang'>): boolean {
  return HEBREW_LANG.test(voice.lang.trim());
}

export function pickVoice<V extends Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService' | 'voiceURI'>>(
  voices: readonly V[],
  requestedName: string | undefined,
  text: string,
): V | null {
  const wanted = requestedName?.trim();
  if (wanted) {
    const requested = voices.find((v) => v.name === wanted) ?? voices.find((v) => v.voiceURI === wanted);
    // קול שהמשתמש בחר מכובד — אלא אם הוא לא עברי והטקסט עברי
    if (requested && (isHebrewVoice(requested) || !HEBREW_TEXT.test(text))) return requested;
  }
  const hebrew = voices.filter(isHebrewVoice);
  return hebrew.find((v) => v.localService) ?? hebrew[0] ?? null;
}

/** הערכה נדיבה לזמן הקראה מקסימלי — רק כדי שהבטחה לא תיתקע לנצח אם onend לא מגיע. */
export function speakWatchdogMs(text: string, rate: number): number {
  return Math.max(15_000, Math.ceil((text.length * 200) / rate) + 10_000);
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2, Math.max(0.5, rate));
}

export function createSystemSpeakerWith(deps: SystemSpeakerDeps): SystemSpeaker {
  const { synth, createUtterance, timers } = deps;
  const voicesTimeoutMs = deps.voicesTimeoutMs ?? VOICES_TIMEOUT_MS;
  let current: SpeakJob | null = null;
  /** עולה בכל speak/stop — speak שחיכה לרשימת הקולות יודע שבוטל בינתיים. */
  let generation = 0;

  function readVoices(): SpeechSynthesisVoice[] {
    if (!synth) return [];
    try {
      return synth.getVoices();
    } catch {
      return [];
    }
  }

  /** Chromium טוען קולות באיחור: הרשימה ריקה עד 'voiceschanged'. מחכים עם הגבלת זמן. */
  function loadVoices(): Promise<SpeechSynthesisVoice[]> {
    const ready = readVoices();
    if (ready.length > 0 || !synth) return Promise.resolve(ready);
    return new Promise((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        synth.removeEventListener('voiceschanged', onChanged);
        timers.clearTimeout(timer);
        resolve(readVoices());
      };
      const onChanged = (): void => {
        if (readVoices().length > 0) finish();
      };
      synth.addEventListener('voiceschanged', onChanged);
      const timer = timers.setTimeout(finish, voicesTimeoutMs);
    });
  }

  function stopCurrent(): void {
    const job = current;
    if (job) job.settle('stopped');
  }

  async function speak(text: string, options: { voiceName?: string; rate: number }): Promise<SpeakOutcome> {
    if (!synth || !createUtterance) return 'no-voice';
    stopCurrent();
    // מבטלים רק כשיש מה לבטל: ב-Chromium, speak מיד אחרי cancel נבלע לפעמים
    try {
      if (synth.speaking || synth.pending) synth.cancel();
    } catch {
      // אין מה לבטל
    }
    const token = ++generation;
    const content = text.trim();
    if (!content) return 'ended';

    const voices = await loadVoices();
    if (token !== generation) return 'stopped'; // stop() או speak חדש בזמן ההמתנה
    const voice = pickVoice(voices, options.voiceName, content);
    if (!voice) return 'no-voice';

    const rate = clampRate(options.rate);
    return new Promise<SpeakOutcome>((resolve) => {
      const utterance = createUtterance(content);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = rate;
      utterance.pitch = 1;
      utterance.volume = 1;

      // שומרים הפניה ל-utterance עד הסוף: ב-Chromium, utterance שנאסף ע"י ה-GC לא יורה onend
      const job: SpeakJob = {
        utterance,
        watchdog: null,
        settle: (outcome) => {
          if (current !== job) return;
          current = null;
          if (job.watchdog !== null) timers.clearTimeout(job.watchdog);
          job.utterance.onend = null;
          job.utterance.onerror = null;
          resolve(outcome);
        },
      };
      utterance.onend = () => job.settle('ended');
      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        switch (event.error) {
          case 'voice-unavailable':
          case 'language-unavailable':
            job.settle('no-voice');
            break;
          default:
            // canceled / interrupted / synthesis-failed / audio-busy ... — ההקראה לא הושלמה
            job.settle('stopped');
        }
      };
      current = job;
      job.watchdog = timers.setTimeout(() => {
        if (current !== job) return;
        try {
          synth.cancel();
        } catch {
          // ממשיכים לסיים בכל מקרה
        }
        job.settle('stopped');
      }, speakWatchdogMs(content, rate));

      try {
        synth.speak(utterance);
      } catch {
        job.settle('stopped');
      }
    });
  }

  return {
    async listVoices(): Promise<SystemVoiceInfo[]> {
      const voices = await loadVoices();
      return voices.map((v) => ({ name: v.name, lang: v.lang, localService: v.localService }));
    },
    speak,
    stop() {
      generation++;
      stopCurrent();
      try {
        synth?.cancel();
      } catch {
        // אין מה לבטל
      }
    },
    get speaking() {
      return current !== null;
    },
  };
}

export function browserSystemSpeakerDeps(): SystemSpeakerDeps {
  const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  const Utterance = typeof SpeechSynthesisUtterance === 'function' ? SpeechSynthesisUtterance : null;
  return {
    synth,
    createUtterance: Utterance ? (text) => new Utterance(text) : null,
    timers: browserTimers,
  };
}
