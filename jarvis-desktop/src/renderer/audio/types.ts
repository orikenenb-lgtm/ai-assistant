/**
 * ממשק שכבת האודיו ב-renderer. צוות הקול מממש, צוות הממשק צורך.
 * כל האודיו נשאר במחשב עד לתמלול מפורש (לחיצה לדיבור / מילת הפעלה מקומית).
 */

export interface LevelSource {
  /** עוצמה נוכחית 0..1 (RMS מנורמל) — לאנימציה. */
  getLevel(): number;
  /** ממלא את המערך בדגימות waveform (-1..1) מתוך AnalyserNode אמיתי. מחזיר false אם אין מקור פעיל. */
  getWaveform(target: Float32Array): boolean;
}

export type CaptureEndReason = 'silence' | 'manual' | 'max-duration' | 'cancelled' | 'error';

export interface CaptureResult {
  reason: CaptureEndReason;
  /** WAV PCM 16-bit מונו 16kHz. ריק כשבוטל. */
  wav: Uint8Array;
  durationMs: number;
  /** האם זוהה דיבור בכלל (VAD). אם לא — לא שולחים לתמלול. */
  speechDetected: boolean;
}

export interface MicCaptureOptions {
  deviceId?: string;
  silenceTimeoutMs: number;
  maxUtteranceSec: number;
  onLevel?: (level: number) => void;
}

export interface MicCapture extends LevelSource {
  /** מתחיל הקלטה. נפתר כשהמיקרופון פעיל בפועל. זורק MicError אם אין הרשאה/התקן. */
  start(options: MicCaptureOptions): Promise<void>;
  /** נפתר כשההקלטה הסתיימה (שקט / ידני / זמן מקסימלי / ביטול). */
  readonly done: Promise<CaptureResult> | null;
  /** סיום ידני — שולח את מה שהוקלט. */
  stop(): void;
  /** ביטול — זורק את מה שהוקלט. */
  cancel(): void;
  readonly active: boolean;
}

export class MicError extends Error {
  constructor(
    public readonly kind: 'permission-denied' | 'no-device' | 'device-busy' | 'unsupported' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'MicError';
  }
}

export interface PlayOptions {
  /** נקרא ברגע שהאודיו באמת מתחיל להישמע (source.start), אחרי פענוח והפעלת התקן הפלט. */
  onStarted?: () => void;
}

export interface SpeechPlayback extends LevelSource {
  /** משמיע אודיו מקודד (mp3/wav/ogg). נפתר כשההשמעה הסתיימה או נעצרה. */
  play(audio: Uint8Array, mimeType: string, options?: PlayOptions): Promise<'ended' | 'stopped'>;
  stop(): void;
  readonly playing: boolean;
}

export interface SystemVoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
}

export interface SystemSpeaker {
  /** קולות מערכת זמינים (Windows SAPI/OneCore דרך speechSynthesis). */
  listVoices(): Promise<SystemVoiceInfo[]>;
  /**
   * מקריא בקול מערכת. אין גישה לאות האודיו עצמו, לכן אין waveform אמיתי במצב הזה.
   * onStarted נקרא כשההקראה באמת התחילה (utterance.onstart) — לא נקרא אם אין קול מתאים.
   */
  speak(text: string, options: { voiceName?: string; rate: number; onStarted?: () => void }): Promise<'ended' | 'stopped' | 'no-voice'>;
  stop(): void;
  readonly speaking: boolean;
}

export type WakeWordDetectorState = 'stopped' | 'loading' | 'listening' | 'paused' | 'error';

export interface WakeWordDetector {
  readonly engine: 'openwakeword' | 'porcupine';
  /**
   * טוען מודלים ומתחיל האזנה מקומית רציפה. שום אודיו לא יוצא מהמחשב.
   * stop() בזמן ההפעלה: start נדחה עם AbortError ומשחרר את מה שכבר נפתח (לא נשאר מיקרופון פתוח).
   * onStateChange: כל שינוי מצב — כולל מעבר ל-'error' אחרי הפעלה מוצלחת (מיקרופון נותק, אין אודיו וכו').
   */
  start(options: {
    deviceId?: string;
    sensitivity: number;
    onDetected: () => void;
    onStateChange?: (state: WakeWordDetectorState) => void;
  }): Promise<void>;
  /** השהיה זמנית (למשל בזמן ש-JARVIS מדבר) — מונע הפעלה עצמית. */
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  readonly state: WakeWordDetectorState;
  /** הודעה קצרה (בעברית כשאפשר) על התקלה האחרונה. */
  readonly lastError: string | null;
  /** פירוט טכני של התקלה (לא בעברית) — למסך ההגדרות בלבד. */
  readonly lastErrorDetail?: string | null;
}

/**
 * הגנת הד: משווה תמלול חדש לטקסט האחרון ש-JARVIS הקריא.
 * מחזיר true אם סביר שזה JARVIS ששמע את עצמו.
 */
export type EchoCheck = (transcript: string, lastSpokenText: string | null, msSinceSpeechEnded: number) => boolean;
