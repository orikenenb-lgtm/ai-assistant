/**
 * מנהל מחזור החיים של מילת ההפעלה ב-renderer (הוצא מהבקר כדי שיהיה קטן וניתן לבדיקה):
 *
 * - סידור (serialization): כל הגדרה מחדש נכנסת לשרשרת הבטחות. ההפעלה הקודמת מסתיימת (או מבוטלת)
 *   לפני שהגלאי הישן נעצר והחדש מתחיל — אין שני גלאים פתוחים יחד, ואין "עצירה ישנה" שמכבה את החדש.
 * - נסיונות חוזרים: כשל בהפעלה או תקלה אחרי הפעלה (onStateChange → 'error') → ניסיון חוזר אחרי
 *   5 שניות, 30 שניות, 2 דקות; אחר כך מפסיקים ומציגים את השגיאה עם כפתור "נסה שוב".
 *   חיבור/ניתוק של התקן שמע (devicechange) בזמן שגיאה → ניסיון מיידי.
 * - השהיה: בזמן האזנה / דיבור / בדיקות, ועוד WAKE_TAIL_MS אחרי ש-JARVIS סיים לדבר (מניעת הפעלה עצמית).
 *   הזנב מנוהל בטיימר בלבד (לא בהשוואת שעון קיר) — שינוי שעון המערכת לא משאיר את הגלאי מושהה.
 */
import type { Settings } from '../../shared/settings-schema';
import type { WakeWordDetector } from '../audio';
import { he } from '../i18n/he';
import { errorText, userFacingHebrew } from './messages';

export type WakeStatus = 'off' | 'loading' | 'listening' | 'paused' | 'stopped' | 'error';
export type WakeEngine = 'openwakeword' | 'porcupine';

export interface WakeView {
  status: WakeStatus;
  /** הודעה מלאה בעברית כשהסטטוס error. */
  error: string | null;
  /** פירוט טכני (לא בעברית) לאבחון — מוצג רק במסך ההגדרות. */
  detail?: string | null;
  engine: WakeEngine | null;
  /** הנסיונות האוטומטיים נגמרו — נשאר רק "נסה שוב" ידני. */
  retryExhausted?: boolean;
}

/** טיימרים מוזרקים (בדפדפן: window.setTimeout וכו'; בבדיקות: שעון MOCK). */
export interface SupervisorTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface WakeSupervisorDeps {
  createDetector(engine: WakeEngine): WakeWordDetector;
  timers: SupervisorTimers;
  getSettings(): Settings | null;
  /** פעילות קול אחרת שמחייבת השהיה (האזנה, הקראה, בדיקות מיקרופון). */
  isBusy(): boolean;
  /** זיהוי של מילת ההפעלה מהגלאי הנוכחי. */
  onDetected(): void;
  /** מצב התצוגה השתנה. */
  onView(view: WakeView): void;
  /** הודעה למשתמש על כשל (פעם אחת לכל הודעה שונה). */
  onFailureNotice(message: string): void;
  /** הרשמה ל-devicechange של navigator.mediaDevices (אם קיים). */
  onDeviceChange?: (listener: () => void) => () => void;
}

/** כמה זמן מילת ההפעלה נשארת מושהית אחרי ש-JARVIS סיים לדבר (מניעת הפעלה עצמית מהד). */
export const WAKE_TAIL_MS = 600;
export const WAKE_POLL_MS = 1000;
/** השהיות בין נסיונות חוזרים אוטומטיים אחרי כשל. אחרי האחרון — רק ידני. */
export const WAKE_RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000, 120_000];
/** גלאי שעבד ברציפות כך — מונה הנסיונות מתאפס. */
export const WAKE_HEALTHY_RESET_MS = 60_000;
/** כמה מחכים להפעלה קודמת שנתקעה (למשל getUserMedia שלא חוזר) לפני שממשיכים בכל זאת. */
export const WAKE_CHAIN_WAIT_MS = 10_000;
const DEVICE_CHANGE_DEBOUNCE_MS = 1_000;

function noop(): void {
  // כוונה: לא עושים כלום
}

export class WakeWordSupervisor {
  private readonly deps: WakeSupervisorDeps;
  private detector: WakeWordDetector | null = null;
  private gen = 0;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;
  private pausedByUs = false;
  private tailActive = false;
  private tailTimer: unknown = null;
  private pollTimer: unknown = null;
  private retryTimer: unknown = null;
  private healthyTimer: unknown = null;
  private deviceTimer: unknown = null;
  private readonly waitTimers = new Set<unknown>();
  private attempt = 0;
  private notified: string | null = null;
  private current: WakeView = { status: 'off', error: null, engine: null };
  private readonly unsubscribeDevice: () => void;

  constructor(deps: WakeSupervisorDeps) {
    this.deps = deps;
    let unsub: () => void = noop;
    try {
      unsub = deps.onDeviceChange?.(() => this.onDeviceChange()) ?? noop;
    } catch {
      // אין devicechange בסביבה הזו
    }
    this.unsubscribeDevice = unsub;
  }

  get view(): WakeView {
    return this.current;
  }

  /** הגלאי מאזין בפועל (לא מושהה, לא בשגיאה). */
  get listening(): boolean {
    return this.current.status === 'listening';
  }

  /** האם זיהוי עכשיו צריך להיזרק (פעילות קול או זנב אחרי הקראה). */
  get pausedNow(): boolean {
    return this.deps.isBusy() || this.tailActive;
  }

  /** הגדרות השתנו / הפעלה ראשונה: מתחילים מחדש עם מונה נסיונות נקי. */
  configure(): Promise<void> {
    this.resetRetries();
    return this.enqueue();
  }

  /** "הפעל מחדש" / "נסה שוב" ידני. */
  restart(): Promise<void> {
    return this.configure();
  }

  /** JARVIS סיים לדבר: השהיה לעוד WAKE_TAIL_MS (טיימר, לא שעון קיר). */
  startTail(): void {
    this.tailActive = true;
    this.deps.timers.clearTimeout(this.tailTimer);
    this.tailTimer = this.deps.timers.setTimeout(() => {
      this.tailTimer = null;
      this.tailActive = false;
      this.syncPause();
    }, WAKE_TAIL_MS);
    this.syncPause();
  }

  /** מסנכרן השהיה/חידוש של הגלאי לפי הפעילות הנוכחית, ומעדכן את התצוגה. */
  syncPause(): void {
    const d = this.detector;
    if (!d || this.disposed) return;
    const pause = this.pausedNow;
    try {
      if (pause && !this.pausedByUs && d.state === 'listening') {
        d.pause();
        this.pausedByUs = true;
      } else if (!pause && this.pausedByUs) {
        this.pausedByUs = false;
        if (d.state === 'paused') d.resume();
      }
    } catch {
      // גלאי שנכשל ידווח דרך state/lastError בסנכרון הבא
    }
    this.syncView();
  }

  /** לבדיקות: מחכה שכל ההגדרות שבתור יסתיימו. */
  whenSettled(): Promise<void> {
    return this.chain;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gen++;
    const t = this.deps.timers;
    t.clearTimeout(this.tailTimer);
    t.clearTimeout(this.retryTimer);
    t.clearTimeout(this.healthyTimer);
    t.clearTimeout(this.deviceTimer);
    t.clearInterval(this.pollTimer);
    for (const h of this.waitTimers) t.clearTimeout(h);
    this.waitTimers.clear();
    this.pollTimer = null;
    try {
      this.unsubscribeDevice();
    } catch {
      // כבר הוסר
    }
    const d = this.detector;
    this.detector = null;
    if (d) void d.stop().catch(noop);
  }

  /* ---------------- פנימי ---------------- */

  private resetRetries(): void {
    this.attempt = 0;
    this.deps.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** מוסיף שלב לשרשרת. גלאי שעוד נטען מבוטל מיד — כך השלב הקודם מסתיים מהר. */
  private enqueue(): Promise<void> {
    const gen = ++this.gen;
    const prev = this.chain;
    const loading = this.detector;
    if (loading && loading.state === 'loading') void loading.stop().catch(noop);
    const step = (async () => {
      await this.waitFor(prev, WAKE_CHAIN_WAIT_MS);
      if (gen !== this.gen || this.disposed) return;
      await this.apply(gen);
    })();
    this.chain = step.catch(noop);
    return this.chain;
  }

  private waitFor(promise: Promise<unknown>, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const t = this.deps.timers;
      const handle = t.setTimeout(() => {
        this.waitTimers.delete(handle);
        resolve();
      }, ms);
      this.waitTimers.add(handle);
      const done = () => {
        t.clearTimeout(handle);
        this.waitTimers.delete(handle);
        resolve();
      };
      promise.then(done, done);
    });
  }

  private async apply(gen: number): Promise<void> {
    const t = this.deps.timers;
    const old = this.detector;
    this.detector = null;
    this.pausedByUs = false;
    // הגדרה חדשה מחליפה כל ניסיון חוזר שתוזמן קודם
    t.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    t.clearTimeout(this.healthyTimer);
    this.healthyTimer = null;
    if (old) await old.stop().catch(noop);
    if (gen !== this.gen || this.disposed) return;

    const s = this.deps.getSettings();
    if (!s || !s.wakeWord.enabled) {
      this.resetRetries();
      this.notified = null;
      t.clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.setView({ status: 'off', error: null, engine: null });
      return;
    }
    const engine = s.wakeWord.engine;
    this.setView({ status: 'loading', error: null, engine });

    let detector: WakeWordDetector;
    try {
      detector = this.deps.createDetector(engine);
    } catch (err) {
      this.fail(errorText(err), null, engine);
      return;
    }
    this.detector = detector;
    try {
      await detector.start({
        deviceId: s.voice.micDeviceId || undefined,
        sensitivity: s.wakeWord.sensitivity,
        onDetected: () => this.onDetected(detector),
        onStateChange: () => this.onDetectorState(detector, gen),
      });
    } catch (err) {
      // הוחלף בזמן ההפעלה: השלב הבא בשרשרת יעצור אותו. תקלה שכבר טופלה ב-onStateChange — גם.
      if (gen !== this.gen || this.disposed || this.detector !== detector) return;
      this.detector = null;
      void detector.stop().catch(noop);
      this.fail(detector.lastError || errorText(err), detector.lastErrorDetail ?? null, engine);
      return;
    }
    if (gen !== this.gen || this.disposed || this.detector !== detector) return;

    // הצלחה
    this.notified = null;
    this.healthyTimer = t.setTimeout(() => {
      this.healthyTimer = null;
      this.attempt = 0;
    }, WAKE_HEALTHY_RESET_MS);
    if (this.pollTimer === null) {
      // גיבוי ל-onStateChange: סנכרון תקופתי של המצב האמיתי
      this.pollTimer = t.setInterval(() => this.syncView(), WAKE_POLL_MS);
    }
    this.syncPause();
  }

  private onDetected(detector: WakeWordDetector): void {
    if (detector !== this.detector || this.disposed) return;
    this.deps.onDetected();
  }

  private onDetectorState(detector: WakeWordDetector, gen: number): void {
    if (detector !== this.detector || gen !== this.gen || this.disposed) return;
    // מצב חדש (למשל 'listening' אחרי טעינה) — אולי צריך להשהות מיד
    this.syncPause();
  }

  /** מעתיק את מצב הגלאי האמיתי לתצוגה; גלאי שנפל באמצע → כשל + ניסיון חוזר. */
  private syncView(): void {
    const d = this.detector;
    if (!d || this.disposed) return;
    if (d.state === 'error') {
      this.detector = null;
      this.pausedByUs = false;
      void d.stop().catch(noop);
      this.fail(d.lastError || he.wake.unknownReason, d.lastErrorDetail ?? null, d.engine);
      return;
    }
    this.setView({ status: d.state, error: null, engine: d.engine });
  }

  private fail(reason: string, detail: string | null, engine: WakeEngine): void {
    this.deps.timers.clearTimeout(this.healthyTimer);
    this.healthyTimer = null;
    // רק הודעה בעברית נכנסת לטקסט למשתמש; פירוט טכני נשמר למסך ההגדרות
    const hebrew = userFacingHebrew(reason);
    const message = he.wake.unavailable(
      hebrew ? hebrew.trim().replace(/[.。]+$/u, '') : reason ? he.wake.technicalReason : he.wake.unknownReason,
    );
    const technicalDetail = detail ?? (!hebrew && reason ? reason.slice(0, 300) : null);
    const exhausted = this.attempt >= WAKE_RETRY_DELAYS_MS.length;
    this.setView({ status: 'error', error: message, detail: technicalDetail, engine, retryExhausted: exhausted });
    if (this.notified !== message) {
      this.notified = message;
      this.deps.onFailureNotice(message);
    }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    const t = this.deps.timers;
    t.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const delay = WAKE_RETRY_DELAYS_MS[this.attempt];
    if (delay === undefined) return; // נגמרו הנסיונות — "נסה שוב" ידני
    this.attempt++;
    this.retryTimer = t.setTimeout(() => {
      this.retryTimer = null;
      void this.enqueue();
    }, delay);
  }

  private onDeviceChange(): void {
    if (this.disposed || this.current.status !== 'error') return;
    // מיקרופון חובר/הוחלף בזמן שמילת ההפעלה בשגיאה — מנסים שוב מיד (עם debounce קצר)
    const t = this.deps.timers;
    t.clearTimeout(this.deviceTimer);
    this.deviceTimer = t.setTimeout(() => {
      this.deviceTimer = null;
      if (!this.disposed && this.current.status === 'error') void this.restart();
    }, DEVICE_CHANGE_DEBOUNCE_MS);
  }

  private setView(next: WakeView): void {
    const cur = this.current;
    if (
      cur.status === next.status &&
      cur.error === next.error &&
      (cur.detail ?? null) === (next.detail ?? null) &&
      cur.engine === next.engine &&
      Boolean(cur.retryExhausted) === Boolean(next.retryExhausted)
    ) {
      return;
    }
    this.current = next;
    this.deps.onView(next);
  }
}
