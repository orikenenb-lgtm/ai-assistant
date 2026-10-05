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
const HEBREW_TEXT = /[\u0590-\u05FF]/;

type SpeakOutcome = 'ended' | 'stopped' | 'no-voice';

interface SpeakJob {
  /** null בזמן שמחכים לרשימת הקולות. */
  utterance: SpeechSynthesisUtterance | null;
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

  /** מבטל רק כשיש מה לבטל: ב-Chromium, speak מיד אחרי cancel נבלע לפעמים. */
  function cancelSynth(): void {
    if (!synth) return;
    try {
      if (synth.speaking || synth.pending) synth.cancel();
    } catch {
      // אין מה לבטל
    }
  }

  function startUtterance(job: SpeakJob, content: string, voice: SpeechSynthesisVoice, rate: number, onStarted?: () => void): void {
    if (!synth || !createUtterance) {
      job.settle('no-voice');
      return;
    }
    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = createUtterance(content);
    } catch {
      job.settle('no-voice');
      return;
    }
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    let started = false;
    const markStarted = () => {
      if (started || current !== job) return;
      started = true;
      try {
        onStarted?.();
      } catch {
        // מאזין שנכשל לא עוצר את ההקראה
      }
    };
    // onstart = הקול באמת התחיל להישמע. מנועים שלא יורים onstart — מסמנים לכל המאוחר בסיום.
    utterance.onstart = markStarted;
    utterance.onend = () => {
      markStarted();
      job.settle('ended');
    };
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
    // שומרים הפניה ל-utterance עד הסוף: ב-Chromium, utterance שנאסף ע"י ה-GC לא יורה onend
    job.utterance = utterance;
    job.watchdog = timers.setTimeout(() => {
      if (current !== job) return;
      cancelSynth();
      job.settle('stopped');
    }, speakWatchdogMs(content, rate));
    try {
      synth.speak(utterance);
    } catch {
      job.settle('stopped');
    }
  }

  /**
   * לא async בכוונה: ההבטחה נוצרת מיד ונרשמת כ-current, כך ש-stop() (או speak חדש)
   * פותרים אותה מיד ב-'stopped' — גם אם עוד מחכים לרשימת הקולות.
   */
  function speak(text: string, options: { voiceName?: string; rate: number; onStarted?: () => void }): Promise<SpeakOutcome> {
    if (!synth || !createUtterance) return Promise.resolve('no-voice');
    current?.settle('stopped');
    cancelSynth();
    const content = text.trim();
    if (!content) return Promise.resolve('ended');
    const rate = clampRate(options.rate);

    return new Promise<SpeakOutcome>((resolve) => {
      const job: SpeakJob = {
        utterance: null,
        watchdog: null,
        settle: (outcome) => {
          if (current !== job) return;
          current = null;
          if (job.watchdog !== null) timers.clearTimeout(job.watchdog);
          if (job.utterance) {
            job.utterance.onstart = null;
            job.utterance.onend = null;
            job.utterance.onerror = null;
          }
          resolve(outcome);
        },
      };
      current = job;
      void loadVoices().then((voices) => {
        if (current !== job) return; // נעצר או הוחלף בזמן ההמתנה לקולות
        const voice = pickVoice(voices, options.voiceName, content);
        if (!voice) job.settle('no-voice');
        else startUtterance(job, content, voice, rate, options.onStarted);
      });
    });
  }

  return {
    async listVoices(): Promise<SystemVoiceInfo[]> {
      const voices = await loadVoices();
      return voices.map((v) => ({ name: v.name, lang: v.lang, localService: v.localService }));
    },
    speak,
    stop() {
      current?.settle('stopped');
      cancelSynth();
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
