import type { Clock, Database, EventSink, Logger } from '../core/contracts';
import type { AssistantEvent, ReminderDTO } from '../../shared/types';
import type { Settings } from '../../shared/settings-schema';
import { formatLocalTime } from '../time/time';
import type { Notifier, NotificationRequest } from './notifier';

/**
 * מתזמן התזכורות. רץ ב-main כל עוד JARVIS פועל (גם ממוזער למגש).
 *
 * - בדיקה מחזורית (ברירת מחדל כל 30 שניות) + טיימר מדויק לתזכורת הבאה שבחלון הקרוב,
 *   כדי שההתראה תקפוץ בדיוק בדקה.
 * - תזכורת שאיחורה בתוך חלון החסד (settings.reminders.graceMinutes) — מוצגת כרגיל.
 *   מעבר לו (המחשב היה כבוי/ישן, או JARVIS לא רץ) — מסומנת "הוחמצה", ומוצגת התראת סיכום אחת.
 * - המעברים במסד הם אטומיים (UPDATE מותנה בסטטוס), ורק מי שביצע את המעבר מציג התראה —
 *   כך אין התראה כפולה גם עם שני מופעים על אותו קובץ, טיימר+בדיקה מחזורית, או חזרה משינה.
 * - main מחבר את powerMonitor ('resume' / 'unlock-screen') ל-checkNow.
 */

export type CheckReason = 'tick' | 'startup' | 'resume' | 'unlock' | 'created';

export interface ReminderScheduler {
  start(): void;
  stop(): void;
  checkNow(reason: CheckReason): void;
  missedUnacknowledged(): ReminderDTO[];
}

/** ידית טיימר אטומה (NodeJS.Timeout בפועל, או כל ערך בבדיקות). */
export type TimerHandle = unknown;

export interface ReminderSchedulerDeps {
  db: Database;
  clock: Clock;
  notifier: Notifier;
  emit: EventSink;
  logger: Logger;
  getSettings: () => Settings;
  /** מרווח הבדיקה המחזורית. ברירת מחדל 30 שניות. */
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 5 * 60_000;
/**
 * גם כשחלון החסד בהגדרות הוא 0, תזכורת שמגיעה באיחור של שניות בגלל תזמון הטיימר
 * היא "בזמן" ולא "הוחמצה". לכן הסף המעשי לא יורד מדקה (או ממרווח הבדיקה, אם גדול יותר).
 */
const MIN_ON_TIME_TOLERANCE_MS = 60_000;
/** הטיימר המדויק מכוון מעט אחרי המועד, כדי שבזמן הבדיקה due_at_utc <= now בוודאות. */
const PRECISE_SLACK_MS = 20;
/** מגבלת סבבים כשבקשות בדיקה נכנסות תוך כדי בדיקה (מניעת לולאה). */
const MAX_PASSES = 5;

export const REMINDER_TITLE_HE = 'תזכורת';
export const MISSED_TITLE_HE = 'תזכורות שהוחמצו';

/** גוף התראת הסיכום על תזכורות שהוחמצו. */
export function missedSummaryText(missed: readonly ReminderDTO[]): string {
  if (missed.length === 1) {
    const r = missed[0] as ReminderDTO;
    return `הוחמצה תזכורת בזמן שהמחשב היה כבוי או במצב שינה: ${r.text} (${r.dueLocal_he})`;
  }
  return `הוחמצו ${missed.length} תזכורות בזמן שהמחשב היה כבוי או במצב שינה`;
}

/** גוף התראה של תזכורת שהגיע זמנה: "לפתוח את הפרויקט — 08:00". */
export function firedBodyText(r: ReminderDTO): string {
  let time: string;
  try {
    time = formatLocalTime(r.dueAtUtc);
  } catch {
    time = r.dueLocal_he;
  }
  return `${r.text} — ${time}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createReminderScheduler(deps: ReminderSchedulerDeps): ReminderScheduler {
  const { db, clock, notifier, logger } = deps;
  const intervalMs = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, deps.intervalMs ?? DEFAULT_INTERVAL_MS));
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): TimerHandle => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ??
    ((handle: TimerHandle): void => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

  let state: 'idle' | 'running' | 'stopped' = 'idle';
  let tickHandle: TimerHandle | null = null;
  let preciseHandle: TimerHandle | null = null;
  let startupDone = false;
  let checking = false;
  let pendingReason: CheckReason | null = null;

  const safeShow = (request: NotificationRequest): void => {
    try {
      notifier.show(request);
    } catch (err) {
      logger.error('reminders.notify_failed', { error: errorMessage(err) });
    }
  };

  const safeEmit = (event: AssistantEvent): void => {
    try {
      deps.emit(event);
    } catch (err) {
      logger.error('reminders.emit_failed', { type: event.type, error: errorMessage(err) });
    }
  };

  /** סף "בזמן": חלון החסד מההגדרות, ולא פחות מהסובלנות המינימלית. */
  const onTimeThresholdMs = (): number => {
    let graceMinutes = 5;
    try {
      graceMinutes = deps.getSettings().reminders.graceMinutes;
    } catch (err) {
      logger.warn('reminders.settings_unavailable', { error: errorMessage(err) });
    }
    const graceMs = Number.isFinite(graceMinutes) && graceMinutes >= 0 ? graceMinutes * 60_000 : 5 * 60_000;
    return Math.max(graceMs, MIN_ON_TIME_TOLERANCE_MS, intervalMs + 5_000);
  };

  const clearPrecise = (): void => {
    if (preciseHandle !== null) {
      clearTimer(preciseHandle);
      preciseHandle = null;
    }
  };

  /** טיימר מדויק לתזכורת הבאה, אם היא בתוך מרווח הבדיקה הקרוב. */
  const armPrecise = (): void => {
    clearPrecise();
    if (state !== 'running') return;
    try {
      const nowMs = clock.now().getTime();
      const next = db.reminders.list('upcoming').find((r) => Date.parse(r.dueAtUtc) > nowMs);
      if (!next) return;
      const delay = Date.parse(next.dueAtUtc) - nowMs;
      if (delay > intervalMs) return; // הבדיקה המחזורית הבאה תכוון אותו
      preciseHandle = setTimer(() => {
        preciseHandle = null;
        if (state === 'running') checkNow('tick');
      }, delay + PRECISE_SLACK_MS);
    } catch (err) {
      logger.error('reminders.arm_failed', { error: errorMessage(err) });
    }
  };

  const scheduleTick = (): void => {
    if (tickHandle !== null) clearTimer(tickHandle);
    tickHandle = setTimer(() => {
      tickHandle = null;
      if (state !== 'running') return;
      try {
        checkNow('tick');
      } finally {
        if (state === 'running') scheduleTick();
      }
    }, intervalMs);
  };

  /** סבב בדיקה אחד: מה שהגיע זמנו — מוצג או מסומן כמוחמץ. */
  const runCheck = (reason: CheckReason): void => {
    const isStartup = reason === 'startup' && !startupDone;
    if (reason === 'startup') startupDone = true;

    let snapshot: { nowMs: number; nowIso: string; due: ReminderDTO[] };
    try {
      const now = clock.now();
      const nowIso = now.toISOString();
      snapshot = { nowMs: now.getTime(), nowIso, due: db.reminders.dueScheduled(nowIso) };
    } catch (err) {
      logger.error('reminders.check_failed', { reason, error: errorMessage(err) });
      return;
    }
    const { nowMs, nowIso, due } = snapshot;

    const thresholdMs = due.length > 0 ? onTimeThresholdMs() : 0;
    const newlyMissed: ReminderDTO[] = [];
    let fired = 0;

    for (const r of due) {
      try {
        const dueMs = Date.parse(r.dueAtUtc);
        const latenessMs = nowMs - dueMs;
        if (Number.isFinite(dueMs) && latenessMs <= thresholdMs) {
          // רק מי שביצע את המעבר scheduled -> fired מציג התראה
          if (!db.reminders.markFired(r.id, nowIso)) continue;
          fired++;
          const firedReminder = db.reminders.get(r.id) ?? { ...r, status: 'fired' as const, firedAt: nowIso };
          safeShow({ title: REMINDER_TITLE_HE, body: firedBodyText(r) });
          safeEmit({ type: 'reminder-fired', reminder: firedReminder });
          logger.info('reminders.fired', { id: r.id, latenessMs, reason });
        } else if (db.reminders.markMissed(r.id)) {
          newlyMissed.push(r);
          logger.info('reminders.missed', { id: r.id, latenessMs, reason });
        }
      } catch (err) {
        // תזכורת אחת בעייתית לא חוסמת את האחרות; היא תיבדק שוב בסבב הבא
        logger.error('reminders.process_failed', { id: r.id, error: errorMessage(err) });
      }
    }

    try {
      if (newlyMissed.length > 0) {
        // התראת סיכום אחת בלבד, והממשק מקבל את כל מה שעוד לא אושר (חדשות + ישנות)
        safeShow({ title: MISSED_TITLE_HE, body: missedSummaryText(newlyMissed) });
        safeEmit({ type: 'missed-reminders', reminders: db.reminders.listMissedUnacknowledged() });
      } else if (isStartup) {
        // בהפעלה: תזכורות ישנות שהוחמצו ועוד לא אושרו — מוצגות בממשק, בלי Toast חוזר
        const older = db.reminders.listMissedUnacknowledged();
        if (older.length > 0) safeEmit({ type: 'missed-reminders', reminders: older });
      }
    } catch (err) {
      logger.error('reminders.missed_report_failed', { error: errorMessage(err) });
    }

    if (fired > 0 || newlyMissed.length > 0) {
      safeEmit({ type: 'data-changed', scope: 'reminders' });
    }
  };

  function checkNow(reason: CheckReason): void {
    if (state === 'stopped') return;
    // בקשה שנכנסת תוך כדי בדיקה (למשל emit שגרם ליצירת תזכורת) נדחית לסוף הסבב הנוכחי
    if (checking) {
      pendingReason = pendingReason === 'startup' ? 'startup' : reason;
      return;
    }
    checking = true;
    try {
      let next: CheckReason | null = reason;
      let passes = 0;
      while (next !== null && passes < MAX_PASSES) {
        pendingReason = null;
        runCheck(next);
        next = pendingReason;
        passes++;
      }
      pendingReason = null;
    } finally {
      checking = false;
    }
    armPrecise();
  }

  return {
    start() {
      if (state === 'running') return;
      state = 'running';
      if (!startupDone) checkNow('startup');
      else checkNow('tick');
      scheduleTick();
    },

    stop() {
      state = 'stopped';
      clearPrecise();
      if (tickHandle !== null) {
        clearTimer(tickHandle);
        tickHandle = null;
      }
    },

    checkNow,

    missedUnacknowledged() {
      try {
        return db.reminders.listMissedUnacknowledged();
      } catch (err) {
        logger.error('reminders.list_missed_failed', { error: errorMessage(err) });
        return [];
      }
    },
  };
}
