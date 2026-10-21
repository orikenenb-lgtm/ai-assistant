/**
 * הקראת תשובה (הוצא מהבקר): חלוקה לקטעים, סינתזה בענן עם טעינה מוקדמת של הקטע הבא, השמעה,
 * ונפילה לקול המערכת. הבקר מקבל אות "התחיל" רק כשאודיו באמת נשמע (source.start / utterance.onstart),
 * כך שה-HUD לא מציג "מדבר" כשעוד לא נשמע כלום (או כשאין קול מערכת בכלל).
 *
 * עצירה (stop) מבטלת גם סינתזה שעוד בדרך (voice:cancel עם requestId), כדי לא להמשיך לעבוד בענן לחינם.
 */
import type { SynthesizeResult } from '../../shared/api-types';
import type { SpeechPlayback, SystemSpeaker } from '../audio';
import { he } from '../i18n/he';
import { ipcErrorMessage } from './messages';
import { splitForSynthesis } from './speech-text';

export type SpeakOutcome = 'ended' | 'stopped' | 'failed';
export type SpeechChannel = 'audio' | 'system';

export interface SpeechOutputDeps {
  synthesize(input: { text: string; requestId: string }): Promise<SynthesizeResult>;
  /** ביטול בקשת סינתזה שבדרך (שגיאות נבלעות). */
  cancelSynthesis(requestId: string): void;
  createPlayback(): SpeechPlayback;
  createSystemSpeaker(): SystemSpeaker;
  newRequestId(): string;
  notify(kind: 'warning' | 'error', text: string, opts?: { ttlMs?: number }): void;
}

export interface SpeakRequest {
  text: string;
  provider: 'azure' | 'openai' | 'system';
  rate: number;
  systemVoiceName?: string;
  /** האודיו התחיל להישמע בערוץ הזה (נקרא שוב אם הערוץ מתחלף באמצע — ענן ← קול מערכת). */
  onStarted(channel: SpeechChannel): void;
}

export class SpeechOutput {
  private readonly deps: SpeechOutputDeps;
  private seq = 0;
  private readonly inflight = new Set<string>();
  private playbackInstance: SpeechPlayback | null = null;
  private speakerInstance: SystemSpeaker | null = null;

  constructor(deps: SpeechOutputDeps) {
    this.deps = deps;
  }

  /** ההשמעה (אם נוצרה) — מקור העוצמה וה-waveform ל-HUD. */
  get playback(): SpeechPlayback | null {
    return this.playbackInstance;
  }

  get systemSpeaker(): SystemSpeaker {
    if (!this.speakerInstance) this.speakerInstance = this.deps.createSystemSpeaker();
    return this.speakerInstance;
  }

  private getPlayback(): SpeechPlayback {
    if (!this.playbackInstance) this.playbackInstance = this.deps.createPlayback();
    return this.playbackInstance;
  }

  /** מקריא (ועוצר קודם כל הקראה קודמת). נפתר כשההקראה הסתיימה / נעצרה / נכשלה. */
  async speak(req: SpeakRequest): Promise<SpeakOutcome> {
    this.stop();
    const seq = this.seq;
    try {
      return req.provider === 'system' ? await this.speakWithSystem(req.text, seq, req) : await this.speakWithCloud(seq, req);
    } catch {
      if (seq === this.seq) this.deps.notify('error', he.toasts.speechFailed);
      return 'failed';
    }
  }

  /** עוצר השמעה, קול מערכת וסינתזה שבדרך. */
  stop(): void {
    this.seq++;
    this.cancelInflight();
    safely(() => this.playbackInstance?.stop());
    safely(() => this.speakerInstance?.stop());
  }

  private cancelInflight(): void {
    for (const id of this.inflight) safely(() => this.deps.cancelSynthesis(id));
    this.inflight.clear();
  }

  private async speakWithSystem(text: string, seq: number, req: SpeakRequest): Promise<SpeakOutcome> {
    const result = await this.systemSpeaker.speak(text, {
      voiceName: req.systemVoiceName || undefined,
      rate: req.rate,
      onStarted: () => {
        if (seq === this.seq) req.onStarted('system');
      },
    });
    if (seq !== this.seq) return 'stopped';
    if (result === 'no-voice') {
      // לא הושמע כלום בפועל — onStarted לא נקרא, וה-HUD לא הציג "מדבר"
      this.deps.notify('warning', he.toasts.noSystemVoice, { ttlMs: 14_000 });
      return 'failed';
    }
    return result;
  }

  private synth(chunk: string): Promise<SynthesizeResult> {
    const requestId = this.deps.newRequestId();
    this.inflight.add(requestId);
    return this.deps
      .synthesize({ text: chunk, requestId })
      .catch((err: unknown): SynthesizeResult => ({ ok: false, code: 'INTERNAL', message_he: ipcErrorMessage(err) }))
      .finally(() => this.inflight.delete(requestId));
  }

  private async speakWithCloud(seq: number, req: SpeakRequest): Promise<SpeakOutcome> {
    const chunks = splitForSynthesis(req.text);
    if (chunks.length === 0) return 'ended';
    let pending = this.synth(chunks[0] as string);
    for (let i = 0; i < chunks.length; i++) {
      const res = await pending;
      if (seq !== this.seq) return 'stopped';
      const rest = chunks.slice(i).join(' ');
      if (!res.ok) {
        // נפילה לקול המערכת — עם הודעה, כדי שלא ייראה כאילו הקול בענן עבד
        this.deps.notify('warning', he.toasts.synthFallback(res.message_he));
        return this.speakWithSystem(rest, seq, req);
      }
      // טעינה מוקדמת של הקטע הבא בזמן שהנוכחי מושמע
      const next = chunks[i + 1];
      if (next !== undefined) pending = this.synth(next);

      let played: 'ended' | 'stopped';
      try {
        played = await this.getPlayback().play(res.audio, res.mimeType, {
          onStarted: () => {
            if (seq === this.seq) req.onStarted('audio');
          },
        });
      } catch {
        if (seq !== this.seq) return 'stopped';
        this.cancelInflight();
        this.deps.notify('warning', he.toasts.playbackFallback);
        return this.speakWithSystem(rest, seq, req);
      }
      if (seq !== this.seq || played === 'stopped') return 'stopped';
    }
    return 'ended';
  }
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // ניקוי משאבים לא אמור להפיל את הזרימה
  }
}
