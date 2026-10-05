import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/main/core/contracts';
import type { AssistantEvent, ReminderDTO } from '../../../src/shared/types';
import { openDatabase } from '../../../src/main/db/database';
import { DEFAULT_INTERVAL_MS, createReminderScheduler, type ReminderScheduler } from '../../../src/main/reminders/scheduler';
import { formatHebrewFull } from '../../../src/main/time/time';
import {
  mockClock,
  mockLogger,
  mockNotifier,
  mockSettings,
  mockTimers,
  tempDir,
  type MockClock,
  type MockNotifier,
  type MockTimers,
} from './mock-helpers';

const T0 = '2026-10-05T05:00:00.000Z'; // 08:00 בישראל
const MIN = 60_000;
const HOUR = 60 * MIN;

function addReminder(db: Database, text: string, dueIso: string): ReminderDTO {
  return db.reminders.create({ text, dueAtUtc: dueIso, timezone: 'Asia/Jerusalem', dueLocal_he: formatHebrewFull(dueIso) });
}

function iso(baseIso: string, plusMs: number): string {
  return new Date(Date.parse(baseIso) + plusMs).toISOString();
}

interface Harness {
  clock: MockClock;
  timers: MockTimers;
  notifier: MockNotifier;
  events: AssistantEvent[];
  scheduler: ReminderScheduler;
  db: Database;
}

function harness(
  db: Database,
  clock: MockClock,
  opts?: { graceMinutes?: number; emit?: (e: AssistantEvent) => void; intervalMs?: number | 'default' },
): Harness {
  const timers = mockTimers(clock);
  const notifier = mockNotifier(clock);
  const events: AssistantEvent[] = [];
  const settings = mockSettings({ graceMinutes: opts?.graceMinutes ?? 5 });
  const scheduler = createReminderScheduler({
    db,
    clock,
    notifier,
    emit: (e) => {
      events.push(e);
      opts?.emit?.(e);
    },
    logger: mockLogger(),
    getSettings: () => settings,
    ...(opts?.intervalMs === 'default' ? {} : { intervalMs: opts?.intervalMs ?? 30_000 }),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { clock, timers, notifier, events, scheduler, db };
}

const ofType = <T extends AssistantEvent['type']>(events: AssistantEvent[], type: T) =>
  events.filter((e): e is Extract<AssistantEvent, { type: T }> => e.type === type);

describe('reminder scheduler (mock clock + mock notifier)', () => {
  let clock: MockClock;
  let db: Database;
  beforeEach(() => {
    clock = mockClock(T0);
    db = openDatabase(':memory:', { clock });
  });
  afterEach(() => db.close());

  it('fires exactly on time via the precise timer (mock)', () => {
    const due = iso(T0, 10 * MIN + 17_000); // 08:10:17
    const r = addReminder(db, 'לפתוח את הפרויקט', due);
    const h = harness(db, clock);
    h.scheduler.start();
    h.scheduler.checkNow('startup');
    expect(h.notifier.shown).toHaveLength(0);

    h.timers.advance(10 * MIN + 17_000 + 1_000);
    expect(h.notifier.shown).toHaveLength(1);
    const shown = h.notifier.shown[0]!;
    expect(shown.title).toBe('תזכורת');
    expect(shown.body).toBe('לפתוח את הפרויקט — 08:10');
    // הופעל בתוך פחות משנייה מהמועד — לא בבדיקה המחזורית הבאה
    expect(shown.atMs - Date.parse(due)).toBeGreaterThanOrEqual(0);
    expect(shown.atMs - Date.parse(due)).toBeLessThan(1_000);

    const fired = ofType(h.events, 'reminder-fired');
    expect(fired).toHaveLength(1);
    expect(fired[0]!.reminder).toMatchObject({ id: r.id, status: 'fired' });
    expect(db.reminders.get(r.id)?.status).toBe('fired');

    // שום התראה נוספת בהמשך
    h.timers.advance(2 * HOUR);
    expect(h.notifier.shown).toHaveLength(1);
    h.scheduler.stop();
  });

  it('a reminder created while running is armed via checkNow("created") (mock)', () => {
    const h = harness(db, clock);
    h.scheduler.start();
    h.timers.advance(5_000);
    const r = addReminder(db, 'לשתות מים', iso(clock.now().toISOString(), 12_000));
    h.scheduler.checkNow('created');
    h.timers.advance(12_100);
    expect(h.notifier.shown.map((n) => n.body)).toEqual([`לשתות מים — 08:00`]);
    expect(db.reminders.get(r.id)?.status).toBe('fired');
    h.scheduler.stop();
  });

  it('grace window: late within graceMinutes fires normally, beyond it is missed (mock)', () => {
    const a = addReminder(db, 'בתוך החסד', iso(T0, -4 * MIN));
    const b = addReminder(db, 'מחוץ לחסד', iso(T0, -6 * MIN));
    const h = harness(db, clock, { graceMinutes: 5 });
    h.scheduler.checkNow('resume');
    expect(db.reminders.get(a.id)?.status).toBe('fired');
    expect(db.reminders.get(b.id)?.status).toBe('missed');
    expect(h.notifier.shown.map((n) => n.title)).toEqual(['תזכורת', 'תזכורות שהוחמצו']);
    expect(h.notifier.shown[1]!.body).toContain('מחוץ לחסד');
  });

  it('graceMinutes 0 still fires a reminder that is a few seconds late (timer jitter) (mock)', () => {
    const r = addReminder(db, 'דיוק', iso(T0, -3_000));
    const h = harness(db, clock, { graceMinutes: 0 });
    h.scheduler.checkNow('tick');
    expect(db.reminders.get(r.id)?.status).toBe('fired');
  });

  it('sleep: clock jumps 3 hours -> one summary notification and the missed list is emitted (mock)', () => {
    const r1 = addReminder(db, 'אחת', iso(T0, 30 * MIN));
    const r2 = addReminder(db, 'שתיים', iso(T0, 60 * MIN));
    const r3 = addReminder(db, 'שלוש', iso(T0, 90 * MIN));
    const later = addReminder(db, 'אחרי השינה', iso(T0, 5 * HOUR));
    const h = harness(db, clock);
    h.scheduler.start();
    h.timers.advance(10 * MIN); // ער
    expect(h.notifier.shown).toHaveLength(0);

    clock.advance(3 * HOUR); // שינה: השעון קופץ, טיימרים לא רצים
    h.scheduler.checkNow('resume');
    h.timers.flushDue(); // הטיימרים שהתעכבו רצים אחרי ההתעוררות
    h.scheduler.checkNow('unlock');

    expect(h.notifier.shown).toHaveLength(1);
    expect(h.notifier.shown[0]).toMatchObject({
      title: 'תזכורות שהוחמצו',
      body: 'הוחמצו 3 תזכורות בזמן שהמחשב היה כבוי או במצב שינה',
    });
    const missedEvents = ofType(h.events, 'missed-reminders');
    expect(missedEvents).toHaveLength(1);
    expect(missedEvents[0]!.reminders.map((r) => r.id).sort()).toEqual([r1.id, r2.id, r3.id].sort());
    expect(h.scheduler.missedUnacknowledged()).toHaveLength(3);
    expect(db.reminders.get(later.id)?.status).toBe('scheduled');

    // התזכורת שאחרי השינה עדיין מופעלת כרגיל
    h.timers.advance(2 * HOUR);
    expect(h.notifier.shown).toHaveLength(2);
    expect(h.notifier.shown[1]!.body).toBe('אחרי השינה — 13:00');
    h.scheduler.stop();
  });

  it('a single missed reminder gets a specific summary text (mock)', () => {
    addReminder(db, 'להתקשר לרופא', iso(T0, -2 * HOUR));
    const h = harness(db, clock);
    h.scheduler.checkNow('resume');
    expect(h.notifier.shown).toHaveLength(1);
    expect(h.notifier.shown[0]!.body).toContain('הוחמצה תזכורת');
    expect(h.notifier.shown[0]!.body).toContain('להתקשר לרופא');
  });

  it('re-entrancy: checkNow called from inside emit does not double-notify (mock)', () => {
    addReminder(db, 'פעם אחת', iso(T0, -1_000));
    let reentered = 0;
    const h: Harness = harness(db, clock, {
      emit: (e) => {
        if (e.type === 'reminder-fired') {
          reentered++;
          h.scheduler.checkNow('created');
          h.scheduler.checkNow('tick');
        }
      },
    });
    h.scheduler.start();
    expect(reentered).toBe(1);
    expect(h.notifier.shown).toHaveLength(1);
    expect(ofType(h.events, 'reminder-fired')).toHaveLength(1);
    h.scheduler.stop();
  });

  it('start() followed by checkNow("startup") (main.ts order) reports old missed reminders once (mock)', () => {
    const old = addReminder(db, 'ישנה', iso(T0, -5 * HOUR));
    db.reminders.markMissed(old.id);
    const h = harness(db, clock);
    h.scheduler.start();
    h.scheduler.checkNow('startup');
    expect(ofType(h.events, 'missed-reminders')).toHaveLength(1);
    expect(h.notifier.shown).toHaveLength(0); // אין Toast חוזר על ישנות
    h.scheduler.stop();
  });

  it('stop() clears every timer and later checks are no-ops (mock)', () => {
    addReminder(db, 'בקרוב', iso(T0, 10_000));
    const h = harness(db, clock);
    h.scheduler.start();
    expect(h.timers.pending().length).toBe(2); // מחזורי + מדויק
    h.scheduler.stop();
    expect(h.timers.pending()).toEqual([]);
    clock.advance(20_000);
    h.scheduler.checkNow('resume');
    expect(h.notifier.shown).toHaveLength(0);
  });

  it('a throwing notifier or emit does not break the scheduler (mock)', () => {
    addReminder(db, 'א', iso(T0, -1_000));
    const logger = mockLogger();
    const scheduler = createReminderScheduler({
      db,
      clock,
      notifier: {
        show: () => {
          throw new Error('toast failed');
        },
      },
      emit: () => {
        throw new Error('renderer gone');
      },
      logger,
      getSettings: () => mockSettings(),
      setTimer: () => 0,
      clearTimer: () => {},
    });
    expect(() => scheduler.checkNow('tick')).not.toThrow();
    expect(db.reminders.list('upcoming')).toEqual([]);
    expect(logger.errors.map((e) => e.event)).toContain('reminders.notify_failed');
  });
});

describe('reminder scheduler across restarts and instances (file DB, mock)', () => {
  let tmp: ReturnType<typeof tempDir>;
  beforeEach(() => {
    tmp = tempDir();
  });
  afterEach(() => tmp.cleanup());

  it('restart after downtime: missed shown once, never re-notified; acknowledged not shown again (mock)', () => {
    const file = tmp.file('jarvis.db');
    const clock = mockClock(T0);

    // מופע 1: קובע שתי תזכורות ונסגר לפני המועד
    let db = openDatabase(file, { clock });
    const r1 = addReminder(db, 'פגישה', iso(T0, 1 * HOUR));
    const r2 = addReminder(db, 'לשלוח דוח', iso(T0, 2 * HOUR));
    let h = harness(db, clock);
    h.scheduler.start();
    h.timers.advance(10 * MIN);
    h.scheduler.stop();
    db.close();
    expect(h.notifier.shown).toHaveLength(0);

    // המחשב כבוי 5 שעות. מופע 2 עולה
    clock.advance(5 * HOUR);
    db = openDatabase(file, { clock });
    h = harness(db, clock);
    h.scheduler.start();
    h.scheduler.checkNow('startup');
    h.timers.advance(10 * MIN);
    h.scheduler.checkNow('resume');
    expect(h.notifier.shown).toHaveLength(1);
    expect(h.notifier.shown[0]!.body).toBe('הוחמצו 2 תזכורות בזמן שהמחשב היה כבוי או במצב שינה');
    expect(ofType(h.events, 'missed-reminders')).toHaveLength(1);
    expect(ofType(h.events, 'missed-reminders')[0]!.reminders.map((r) => r.id)).toEqual([r1.id, r2.id]);
    h.scheduler.stop();
    db.close();

    // מופע 3: עוד הפעלה מחדש — אין Toast, אבל הממשק מקבל את הרשימה שעוד לא אושרה
    clock.advance(1 * HOUR);
    db = openDatabase(file, { clock });
    h = harness(db, clock);
    h.scheduler.start();
    h.timers.advance(5 * MIN);
    expect(h.notifier.shown).toHaveLength(0);
    expect(ofType(h.events, 'missed-reminders')).toHaveLength(1);
    expect(h.scheduler.missedUnacknowledged().map((r) => r.id)).toEqual([r1.id, r2.id]);
    // המשתמש לוחץ "סמן כנקרא"
    expect(db.reminders.acknowledge([r1.id, r2.id])).toBe(2);
    h.scheduler.stop();
    db.close();

    // מופע 4: שום דבר לא מוצג שוב
    clock.advance(1 * HOUR);
    db = openDatabase(file, { clock });
    h = harness(db, clock);
    h.scheduler.start();
    h.timers.advance(5 * MIN);
    expect(h.notifier.shown).toHaveLength(0);
    expect(ofType(h.events, 'missed-reminders')).toHaveLength(0);
    expect(h.scheduler.missedUnacknowledged()).toEqual([]);
    h.scheduler.stop();
    db.close();
  });

  it('two scheduler instances sharing one DB file never duplicate a notification (mock)', () => {
    const file = tmp.file('shared.db');
    const clock = mockClock(T0);
    const dbA = openDatabase(file, { clock });
    const dbB = openDatabase(file, { clock });
    addReminder(dbA, 'בזמן', iso(T0, 20_000));
    addReminder(dbA, 'הוחמצה', iso(T0, -3 * HOUR));
    const a = harness(dbA, clock);
    const b = harness(dbB, clock);
    a.scheduler.start();
    b.scheduler.start();
    clock.advance(21_000);
    a.scheduler.checkNow('tick');
    b.scheduler.checkNow('tick');
    a.timers.flushDue();
    b.timers.flushDue();
    a.scheduler.checkNow('resume');
    b.scheduler.checkNow('resume');

    const all = [...a.notifier.shown, ...b.notifier.shown];
    expect(all.filter((n) => n.title === 'תזכורת')).toHaveLength(1);
    expect(all.filter((n) => n.title === 'תזכורות שהוחמצו')).toHaveLength(1);
    expect([...ofType(a.events, 'reminder-fired'), ...ofType(b.events, 'reminder-fired')]).toHaveLength(1);
    a.scheduler.stop();
    b.scheduler.stop();
    dbA.close();
    dbB.close();
  });
});

describe('reminder scheduler — review fixes', () => {
  let clock: MockClock;
  let db: Database;
  beforeEach(() => {
    clock = mockClock(T0);
    db = openDatabase(':memory:', { clock });
  });
  afterEach(() => db.close());

  it('the default periodic check interval is 10 seconds (as documented)', () => {
    expect(DEFAULT_INTERVAL_MS).toBe(10_000);
    const h = harness(db, clock, { intervalMs: 'default' });
    h.scheduler.start();
    expect(h.timers.pending().map((t) => t.at - clock.ms())).toEqual([10_000]);
    h.scheduler.stop();
  });

  it('graceMinutes 0 means interval + 5 s at most, not a whole minute', () => {
    const a = addReminder(db, '14 שניות', iso(T0, -14_000));
    const b = addReminder(db, '16 שניות', iso(T0, -16_000));
    const c = addReminder(db, '59 שניות', iso(T0, -59_000));
    const h = harness(db, clock, { graceMinutes: 0, intervalMs: 'default' });
    h.scheduler.checkNow('tick');
    expect(db.reminders.get(a.id)?.status).toBe('fired');
    expect(db.reminders.get(b.id)?.status).toBe('missed');
    expect(db.reminders.get(c.id)?.status).toBe('missed');

    // עם מרווח של 30 שניות — הסף הוא 35 שניות
    const d = addReminder(db, '34 שניות', iso(T0, -34_000));
    const e = addReminder(db, '36 שניות', iso(T0, -36_000));
    harness(db, clock, { graceMinutes: 0, intervalMs: 30_000 }).scheduler.checkNow('tick');
    expect(db.reminders.get(d.id)?.status).toBe('fired');
    expect(db.reminders.get(e.id)?.status).toBe('missed');
  });

  it('emits data-changed "reminders" when it marks a reminder fired and when it marks one missed', () => {
    const r = addReminder(db, 'בזמן', iso(T0, 5_000));
    const h = harness(db, clock);
    h.scheduler.start();
    expect(ofType(h.events, 'data-changed')).toEqual([]);
    h.timers.advance(5_100);
    expect(db.reminders.get(r.id)?.status).toBe('fired');
    expect(ofType(h.events, 'data-changed')).toEqual([{ type: 'data-changed', scope: 'reminders' }]);

    h.events.length = 0;
    addReminder(db, 'בשינה', iso(clock.now().toISOString(), MIN));
    clock.advance(HOUR); // שינה
    h.scheduler.checkNow('resume');
    expect(ofType(h.events, 'missed-reminders')).toHaveLength(1);
    expect(ofType(h.events, 'data-changed')).toEqual([{ type: 'data-changed', scope: 'reminders' }]);
    h.scheduler.stop();
  });

  it('day rollover at local midnight emits data-changed for tasks and reminders once', () => {
    clock.set('2026-10-05T20:59:45.000Z'); // 23:59:45 בישראל
    const h = harness(db, clock, { intervalMs: 'default' });
    h.scheduler.start();
    h.timers.advance(10_000); // 23:59:55 — עוד אותו יום
    expect(ofType(h.events, 'data-changed')).toEqual([]);
    h.timers.advance(10_000); // 00:00:05 — יום חדש
    expect(ofType(h.events, 'data-changed')).toEqual([
      { type: 'data-changed', scope: 'tasks' },
      { type: 'data-changed', scope: 'reminders' },
    ]);
    h.timers.advance(60_000); // באותו יום — אין שידור נוסף
    expect(ofType(h.events, 'data-changed')).toHaveLength(2);

    // חזרה משינה אחרי חצות נוספת
    clock.advance(24 * HOUR);
    h.scheduler.checkNow('resume');
    expect(ofType(h.events, 'data-changed')).toHaveLength(4);
    h.scheduler.stop();
  });

  it('firedSince returns reminders fired at/after the time and not yet acknowledged, oldest first', () => {
    const a = addReminder(db, 'ראשונה', iso(T0, 5_000));
    const b = addReminder(db, 'שנייה', iso(T0, 20_000));
    const h = harness(db, clock);
    h.scheduler.start();
    h.timers.advance(30_000);
    expect(h.scheduler.firedSince(T0).map((r) => r.id)).toEqual([a.id, b.id]);
    expect(h.scheduler.firedSince(iso(T0, 10_000)).map((r) => r.id)).toEqual([b.id]);
    expect(h.scheduler.firedSince(iso(T0, 10_000))[0]).toMatchObject({ status: 'fired', firedAt: iso(T0, 20_000 + 20) });
    db.reminders.acknowledge([a.id]);
    expect(h.scheduler.firedSince(T0).map((r) => r.id)).toEqual([b.id]);
    expect(h.scheduler.firedSince('not a date')).toEqual([]);
    h.scheduler.stop();
  });
});
