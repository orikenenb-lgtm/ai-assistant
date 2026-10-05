import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/main/core/contracts';
import {
  DatabaseOpenError,
  applyPragmas,
  openDatabase,
  openDatabaseWithRetry,
  toOpenError,
  type DataDatabase,
} from '../../../src/main/db/database';
import { LATEST_SCHEMA_VERSION, MigrationError, readUserVersion, runMigrations, type Migration } from '../../../src/main/db/migrations';
import { NoopSyncAdapter } from '../../../src/main/db/sync';
import { ACTION_LOG_RETENTION_MS } from '../../../src/main/db/action-log-repository';
import { mockClock, mockIdFactory, tempDir, type MockClock } from './mock-helpers';

const T0 = '2026-10-05T10:00:00.000Z'; // 13:00 בישראל

function rawRow(file: string, sql: string, ...params: Array<string | number>): Record<string, unknown> | undefined {
  const raw = new DatabaseSync(file);
  try {
    return raw.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  } finally {
    raw.close();
  }
}

describe('openDatabase — file, pragmas, migrations', () => {
  let tmp: ReturnType<typeof tempDir>;
  beforeEach(() => {
    tmp = tempDir();
  });
  afterEach(() => tmp.cleanup());

  it('a task survives close + reopen (acceptance: survives restart)', () => {
    const file = tmp.file('jarvis.db');
    const clock = mockClock(T0);
    const db1 = openDatabase(file, { clock });
    const created = db1.tasks.create({ title: 'לסיים את השרטוט', dueDate: '2026-10-06', notes: 'גיליון 3', source: 'tool' });
    const reminder = db1.reminders.create({
      text: 'לפתוח את הפרויקט',
      dueAtUtc: '2026-10-06T05:00:00.000Z',
      timezone: 'Asia/Jerusalem',
      dueLocal_he: 'יום שלישי, 6 באוקטובר 2026 בשעה 08:00',
    });
    db1.close();
    db1.close(); // סגירה כפולה לא זורקת

    const db2 = openDatabase(file, { clock });
    try {
      expect(db2.tasks.get(created.id)).toEqual(created);
      expect(db2.tasks.list('open', '2026-10-05').map((t) => t.title)).toEqual(['לסיים את השרטוט']);
      expect(db2.reminders.get(reminder.id)).toEqual(reminder);
    } finally {
      db2.close();
    }
  });

  it('creates missing parent directories and applies WAL + user_version', () => {
    const file = tmp.file('nested/deeper/jarvis.db');
    const db = openDatabase(file, { clock: mockClock(T0) });
    db.close();
    expect(existsSync(file)).toBe(true);
    expect(rawRow(file, 'PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' });
    expect(rawRow(file, 'PRAGMA user_version')).toEqual({ user_version: LATEST_SCHEMA_VERSION });
  });

  it('reopening does not re-run migrations', () => {
    const file = tmp.file('j.db');
    openDatabase(file, { clock: mockClock(T0) }).close();
    openDatabase(file, { clock: mockClock(T0) }).close();
    expect(rawRow(file, 'PRAGMA user_version')).toEqual({ user_version: 1 });
  });

  it('works in memory (no WAL)', () => {
    const db = openDatabase(':memory:', { clock: mockClock(T0) });
    expect(db.tasks.create({ title: 'x', source: 'text' }).title).toBe('x');
    db.close();
  });

  it('refuses a database created by a newer JARVIS, with a Hebrew message, and leaves it untouched', () => {
    const file = tmp.file('newer.db');
    const raw = new DatabaseSync(file);
    raw.prepare('PRAGMA user_version = 99').run();
    raw.close();
    let err: unknown;
    try {
      openDatabase(file, { clock: mockClock(T0) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DatabaseOpenError);
    expect((err as DatabaseOpenError).code).toBe('NEWER_SCHEMA');
    expect((err as DatabaseOpenError).message_he).toContain('גרסה חדשה יותר');
    expect(rawRow(file, 'PRAGMA user_version')).toEqual({ user_version: 99 });
  });

  it('reports a corrupt (non-SQLite) file as CORRUPT and does not delete it', () => {
    const file = tmp.file('corrupt.db');
    const garbage = 'this is not a sqlite database '.repeat(40);
    writeFileSync(file, garbage);
    let err: unknown;
    try {
      openDatabase(file, { clock: mockClock(T0) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DatabaseOpenError);
    expect((err as DatabaseOpenError).code).toBe('CORRUPT');
    expect((err as DatabaseOpenError).message_he).toContain('פגום');
    expect(readFileSync(file, 'utf8')).toBe(garbage);
  });

  it('a failing migration rolls back completely (user_version unchanged, no partial table)', () => {
    const raw = new DatabaseSync(':memory:');
    const migrations: Migration[] = [
      { version: 1, description: 'ok', statements: ['CREATE TABLE a (x TEXT)'] },
      { version: 2, description: 'broken', statements: ['CREATE TABLE b (x TEXT)', 'THIS IS NOT SQL'] },
    ];
    expect(() => runMigrations(raw, migrations)).toThrow(MigrationError);
    expect(readUserVersion(raw)).toBe(1);
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    expect(tables.map((t) => t.name)).toEqual(['a']);
    expect(raw.isTransaction).toBe(false);
    raw.close();
  });

  it('rejects a migration list with gaps', () => {
    const raw = new DatabaseSync(':memory:');
    expect(() => runMigrations(raw, [{ version: 2, description: 'gap', statements: [] }])).toThrow(MigrationError);
    raw.close();
  });

  it('NoopSyncAdapter is a documented V2 placeholder that does nothing', async () => {
    const sync = new NoopSyncAdapter();
    await expect(sync.pushChanges('2026-01-01T00:00:00.000Z')).resolves.toBeUndefined();
    await expect(sync.pullChanges()).resolves.toBeUndefined();
  });
});

describe('repositories', () => {
  let clock: MockClock;
  let db: Database;
  beforeEach(() => {
    clock = mockClock(T0);
    db = openDatabase(':memory:', { clock, idFactory: mockIdFactory() });
  });
  afterEach(() => db.close());

  describe('tasks', () => {
    it('create / get / list filters (today includes overdue and undated)', () => {
      const overdue = db.tasks.create({ title: 'לשלם חשבון', dueDate: '2026-10-01', source: 'tool' });
      const today = db.tasks.create({ title: 'לסיים את השרטוט', dueDate: '2026-10-05', source: 'voice' });
      const future = db.tasks.create({ title: 'להזמין חלקים', dueDate: '2026-10-20', source: 'tool' });
      const undated = db.tasks.create({ title: 'לקנות חלב', source: 'text' });
      expect(db.tasks.list('today', '2026-10-05').map((t) => t.id)).toEqual([overdue.id, today.id, undated.id]);
      expect(db.tasks.list('open', '2026-10-05').map((t) => t.id)).toEqual([overdue.id, today.id, future.id, undated.id]);
      db.tasks.complete(today.id);
      expect(db.tasks.list('today', '2026-10-05').map((t) => t.id)).toEqual([overdue.id, undated.id]);
      const all = db.tasks.list('all', '2026-10-05');
      expect(all).toHaveLength(4);
      expect(all[all.length - 1]?.status).toBe('done'); // פתוחות קודם
      expect(db.tasks.get('nope')).toBeNull();
    });

    it('trims, normalizes empty notes to null and validates the due date', () => {
      const t = db.tasks.create({ title: '  לקנות חלב  ', notes: '   ', source: 'tool' });
      expect(t).toMatchObject({ title: 'לקנות חלב', notes: null, dueDate: null, status: 'open', completedAt: null });
      expect(() => db.tasks.create({ title: '   ', source: 'tool' })).toThrow();
      expect(() => db.tasks.create({ title: 'x', dueDate: '2026-02-30', source: 'tool' })).toThrow();
      expect(() => db.tasks.create({ title: 'x', dueDate: '06/10/2026', source: 'tool' })).toThrow();
    });

    it('complete is idempotent and keeps the first completion time', () => {
      const t = db.tasks.create({ title: 'לסיים את השרטוט', source: 'tool' });
      clock.advance(60_000);
      const first = db.tasks.complete(t.id);
      expect(first).toMatchObject({ status: 'done', completedAt: '2026-10-05T10:01:00.000Z' });
      clock.advance(60_000);
      const second = db.tasks.complete(t.id);
      expect(second?.completedAt).toBe('2026-10-05T10:01:00.000Z');
      expect(db.tasks.complete('missing')).toBeNull();
    });

    it('search uses normalized text (niqqud, final letters, prefixes) and only open tasks', () => {
      const a = db.tasks.create({ title: 'לשלוח דוח חודשי', source: 'tool' });
      const b = db.tasks.create({ title: 'לקנות חלב', source: 'tool' });
      const c = db.tasks.create({ title: 'EPLAN — לעדכן שרטוט', source: 'tool' });
      expect(db.tasks.search('הדוח החודשי').map((t) => t.id)).toEqual([a.id]);
      expect(db.tasks.search('חָלָב').map((t) => t.id)).toEqual([b.id]);
      expect(db.tasks.search('eplan').map((t) => t.id)).toEqual([c.id]);
      expect(db.tasks.search('לקנות חלב')[0]?.id).toBe(b.id);
      db.tasks.complete(b.id);
      expect(db.tasks.search('חלב')).toEqual([]);
      expect(db.tasks.search('   ')).toEqual([]);
      expect(db.tasks.search('משהו אחר לגמרי')).toEqual([]);
    });

    it('SQL-injection-shaped titles are stored literally and the schema is intact', () => {
      const evil = [
        "Robert'); DROP TABLE tasks; --",
        '" OR 1=1 --',
        "x'; UPDATE tasks SET status='done' WHERE '1'='1",
        '%_\\',
      ];
      const ids = evil.map((title) => db.tasks.create({ title, notes: title, source: 'tool' }).id);
      ids.forEach((id, i) => {
        expect(db.tasks.get(id)).toMatchObject({ title: evil[i], notes: evil[i], status: 'open' });
      });
      expect(db.tasks.list('open', '2026-10-05')).toHaveLength(evil.length);
      expect(db.tasks.search("'; DROP TABLE tasks; --")).toBeInstanceOf(Array);
      expect(db.tasks.get("' OR '1'='1")).toBeNull();
      // הטבלה עדיין קיימת ופעילה
      expect(db.tasks.create({ title: 'עדיין עובד', source: 'tool' }).title).toBe('עדיין עובד');
    });
  });

  describe('reminders', () => {
    const base = { timezone: 'Asia/Jerusalem', dueLocal_he: 'תיאור' };

    it('create normalizes the UTC timestamp and stores due_local_he', () => {
      const r = db.reminders.create({ ...base, text: ' לשתות מים ', dueAtUtc: '2026-10-05T13:00:00+03:00' });
      expect(r).toMatchObject({
        text: 'לשתות מים',
        dueAtUtc: '2026-10-05T10:00:00.000Z',
        dueLocal_he: 'תיאור',
        status: 'scheduled',
        firedAt: null,
        createdAt: T0,
      });
      expect(() => db.reminders.create({ ...base, text: 'x', dueAtUtc: 'not-a-date' })).toThrow();
      expect(() => db.reminders.create({ ...base, text: ' ', dueAtUtc: T0 })).toThrow();
    });

    it('list filters, dueScheduled ordering and atomic fired/missed transitions', () => {
      const r1 = db.reminders.create({ ...base, text: 'ראשונה', dueAtUtc: '2026-10-05T10:05:00.000Z' });
      const r2 = db.reminders.create({ ...base, text: 'שנייה', dueAtUtc: '2026-10-05T10:01:00.000Z' });
      const r3 = db.reminders.create({ ...base, text: 'שלישית', dueAtUtc: '2026-10-06T10:00:00.000Z' });
      expect(db.reminders.list('upcoming').map((r) => r.id)).toEqual([r2.id, r1.id, r3.id]);
      expect(db.reminders.dueScheduled('2026-10-05T10:00:00.000Z')).toEqual([]);
      expect(db.reminders.dueScheduled('2026-10-05T10:05:00.000Z').map((r) => r.id)).toEqual([r2.id, r1.id]);
      expect(db.reminders.dueScheduled('garbage')).toEqual([]);

      expect(db.reminders.markFired(r2.id, '2026-10-05T10:01:00.000Z')).toBe(true);
      expect(db.reminders.markFired(r2.id, '2026-10-05T10:01:01.000Z')).toBe(false); // שני — נכשל
      expect(db.reminders.markMissed(r2.id)).toBe(false); // כבר fired
      expect(db.reminders.get(r2.id)).toMatchObject({ status: 'fired', firedAt: '2026-10-05T10:01:00.000Z' });

      expect(db.reminders.markMissed(r1.id)).toBe(true);
      expect(db.reminders.markMissed(r1.id)).toBe(false);
      expect(db.reminders.markFired(r1.id, T0)).toBe(false);
      expect(db.reminders.list('missed').map((r) => r.id)).toEqual([r1.id]);
      expect(db.reminders.listMissedUnacknowledged().map((r) => r.id)).toEqual([r1.id]);
      expect(db.reminders.list('all')).toHaveLength(3);
    });

    it('acknowledge moves fired/missed to acknowledged only, once', () => {
      const a = db.reminders.create({ ...base, text: 'א', dueAtUtc: '2026-10-05T09:00:00.000Z' });
      const b = db.reminders.create({ ...base, text: 'ב', dueAtUtc: '2026-10-05T09:30:00.000Z' });
      const c = db.reminders.create({ ...base, text: 'ג', dueAtUtc: '2026-10-07T09:30:00.000Z' });
      db.reminders.markMissed(a.id);
      db.reminders.markFired(b.id, T0);
      expect(db.reminders.acknowledge([a.id, b.id, c.id, a.id, 'missing'])).toBe(2);
      expect(db.reminders.acknowledge([a.id, b.id])).toBe(0);
      expect(db.reminders.acknowledge([])).toBe(0);
      expect(db.reminders.get(a.id)?.status).toBe('acknowledged');
      expect(db.reminders.get(c.id)?.status).toBe('scheduled');
      expect(db.reminders.listMissedUnacknowledged()).toEqual([]);
    });

    it('cancel sets status cancelled (not a hard delete); search finds active ones only', () => {
      const water = db.reminders.create({ ...base, text: 'לשתות מים', dueAtUtc: '2026-10-05T12:00:00.000Z' });
      const call = db.reminders.create({ ...base, text: 'להתקשר לאמא', dueAtUtc: '2026-10-05T15:00:00.000Z' });
      expect(db.reminders.search('מים').map((r) => r.id)).toEqual([water.id]);
      expect(db.reminders.cancel(water.id)?.status).toBe('cancelled');
      expect(db.reminders.get(water.id)?.status).toBe('cancelled');
      expect(db.reminders.list('all').map((r) => r.id)).toContain(water.id);
      expect(db.reminders.list('upcoming').map((r) => r.id)).toEqual([call.id]);
      expect(db.reminders.search('מים')).toEqual([]);
      expect(db.reminders.cancel('missing')).toBeNull();
      // תזכורת שכבר הוצגה לא "מבוטלת" — המצב האמיתי נשמר
      db.reminders.markFired(call.id, T0);
      expect(db.reminders.cancel(call.id)?.status).toBe('fired');
    });
  });

  describe('history', () => {
    it('recent(N) returns the entries of the last N turns in chronological order', () => {
      const add = (turnId: string, role: 'user' | 'assistant', text: string) => {
        clock.advance(1000);
        db.history.append({ turnId, role, text, mode: 'ai', createdAt: clock.now().toISOString() });
      };
      add('t1', 'user', 'שלום');
      add('t1', 'assistant', 'שלום אורי');
      add('t2', 'user', 'מה השעה');
      add('t2', 'assistant', 'שתיים');
      add('t3', 'user', 'תודה');
      add('t3', 'assistant', 'בכיף');
      expect(db.history.recent(2).map((e) => `${e.turnId}:${e.role}:${e.text}`)).toEqual([
        't2:user:מה השעה',
        't2:assistant:שתיים',
        't3:user:תודה',
        't3:assistant:בכיף',
      ]);
      expect(db.history.recent(0)).toEqual([]);
      expect(db.history.recent(-3)).toEqual([]);
      expect(db.history.recent(50)).toHaveLength(6);
      expect(db.history.recent(1)[0]).toMatchObject({ turnId: 't3', role: 'user', mode: 'ai' });
    });

    it('prune deletes entries older than the retention window; clear deletes all', () => {
      db.history.append({ turnId: 'old', role: 'user', text: 'ישן', mode: 'local', createdAt: '2026-08-01T10:00:00.000Z' });
      db.history.append({ turnId: 'new', role: 'user', text: 'חדש', mode: 'ai', createdAt: '2026-10-04T10:00:00.000Z' });
      expect(db.history.prune(30, clock.now())).toBe(1);
      expect(db.history.recent(10).map((e) => e.turnId)).toEqual(['new']);
      expect(db.history.prune(30, clock.now())).toBe(0);
      db.history.clear();
      expect(db.history.recent(10)).toEqual([]);
    });
  });

  describe('action log', () => {
    it('findRecentSuccess respects tool, hash, status and window; record is an upsert', () => {
      db.actions.record({ id: 'a1', turnId: 't1', tool: 'create_task', paramsHash: 'h1', status: 'running', summary: '', createdAt: '2026-10-05T09:59:00.000Z' });
      expect(db.actions.findRecentSuccess('create_task', 'h1', '2026-10-05T09:58:00.000Z')).toBeNull();
      db.actions.record({ id: 'a1', turnId: 't1', tool: 'create_task', paramsHash: 'h1', status: 'succeeded', summary: 'הוספתי', createdAt: '2026-10-05T09:59:00.000Z' });
      expect(db.actions.findRecentSuccess('create_task', 'h1', '2026-10-05T09:58:00.000Z')).toMatchObject({ id: 'a1', status: 'succeeded', summary: 'הוספתי' });
      expect(db.actions.findRecentSuccess('create_task', 'h1', '2026-10-05T09:59:30.000Z')).toBeNull();
      expect(db.actions.findRecentSuccess('create_task', 'h2', '2026-10-05T09:00:00.000Z')).toBeNull();
      expect(db.actions.findRecentSuccess('create_reminder', 'h1', '2026-10-05T09:00:00.000Z')).toBeNull();
      expect(db.actions.findRecentSuccess('create_task', 'h1', 'bad')).toBeNull();
      db.actions.clear();
      expect(db.actions.findRecentSuccess('create_task', 'h1', '2026-10-05T09:00:00.000Z')).toBeNull();
    });
  });

  describe('usage', () => {
    it('summarizes per provider/kind/model for the Israel day and month', () => {
      // now = 2026-10-05 13:00 בישראל
      db.usage.record({ provider: 'anthropic', kind: 'llm', model: 'claude-opus-5-5', inputTokens: 100, outputTokens: 20, createdAt: '2026-10-05T08:00:00.000Z' });
      // 00:30 בישראל ב-5 באוקטובר (עדיין 4 באוקטובר ב-UTC) — נספר כ"היום"
      db.usage.record({ provider: 'anthropic', kind: 'llm', model: 'claude-opus-5-5', inputTokens: 50, outputTokens: 5, createdAt: '2026-10-04T21:30:00.000Z' });
      // 23:30 בישראל ב-4 באוקטובר — החודש, לא היום
      db.usage.record({ provider: 'anthropic', kind: 'llm', model: 'claude-opus-5-5', inputTokens: 7, outputTokens: 1, createdAt: '2026-10-04T20:30:00.000Z' });
      db.usage.record({ provider: 'openai', kind: 'stt', model: 'gpt-transcribe', audioSeconds: 4.25, createdAt: '2026-10-05T09:00:00.000Z' });
      db.usage.record({ provider: 'azure', kind: 'tts', model: 'he-IL-AvriNeural', characters: 120, createdAt: '2026-10-05T09:00:00.000Z' });
      // ספטמבר לפי שעון ישראל (30.9 23:00) — לא נספר כלל
      db.usage.record({ provider: 'anthropic', kind: 'llm', model: 'claude-opus-5-5', inputTokens: 999, outputTokens: 999, createdAt: '2026-09-30T20:00:00.000Z' });
      // ערכים משונים לא שוברים את הסיכום
      db.usage.record({ provider: 'openai', kind: 'stt', model: 'gpt-transcribe', audioSeconds: Number.NaN, createdAt: '2026-10-05T09:00:00.000Z' });

      const rows = db.usage.summary(clock.now());
      const find = (period: string, provider: string) => rows.find((r) => r.period === period && r.provider === provider);
      expect(find('today', 'anthropic')).toEqual({
        provider: 'anthropic', kind: 'llm', model: 'claude-opus-5-5', period: 'today', requests: 2, inputTokens: 150, outputTokens: 25, audioSeconds: 0, characters: 0,
      });
      expect(find('month', 'anthropic')).toMatchObject({ requests: 3, inputTokens: 157, outputTokens: 26 });
      expect(find('today', 'openai')).toMatchObject({ kind: 'stt', requests: 2, audioSeconds: 4.3 });
      expect(find('today', 'azure')).toMatchObject({ kind: 'tts', characters: 120, requests: 1 });
      expect(rows.filter((r) => r.period === 'today')).toHaveLength(3);
      expect(rows.filter((r) => r.period === 'month')).toHaveLength(3);
      db.usage.clear();
      expect(db.usage.summary(clock.now())).toEqual([]);
    });
  });
});

describe('two connections on one file', () => {
  it('markFired succeeds for exactly one connection', () => {
    const tmp = tempDir();
    try {
      const file = tmp.file('shared.db');
      const clock = mockClock(T0);
      const a = openDatabase(file, { clock });
      const b = openDatabase(file, { clock });
      const r = a.reminders.create({ text: 'x', dueAtUtc: T0, timezone: 'Asia/Jerusalem', dueLocal_he: 'x' });
      expect(b.reminders.dueScheduled(T0).map((x) => x.id)).toEqual([r.id]);
      expect(a.reminders.markFired(r.id, T0)).toBe(true);
      expect(b.reminders.markFired(r.id, T0)).toBe(false);
      expect(b.reminders.markMissed(r.id)).toBe(false);
      a.close();
      b.close();
    } finally {
      tmp.cleanup();
    }
  });
});

describe('review fixes — durability and open retry', () => {
  let tmp: ReturnType<typeof tempDir>;
  beforeEach(() => {
    tmp = tempDir();
  });
  afterEach(() => tmp.cleanup());

  it('file connections use WAL + synchronous=FULL, with busy_timeout set first', () => {
    const raw = new DatabaseSync(tmp.file('p.db'));
    try {
      applyPragmas(raw, false);
      expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
      expect(raw.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 }); // 2 = FULL
      expect(raw.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 3000 });
      expect(raw.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    } finally {
      raw.close();
    }
  });

  it('classifies SQLITE_BUSY/LOCKED (also inside a MigrationError) as BUSY, corruption as CORRUPT', () => {
    const sqliteErr = (errcode: number) => Object.assign(new Error('sqlite'), { errcode });
    expect(toOpenError(sqliteErr(5)).code).toBe('BUSY');
    expect(toOpenError(sqliteErr(6)).code).toBe('BUSY');
    expect(toOpenError(sqliteErr(5 | (1 << 8))).code).toBe('BUSY'); // extended code SQLITE_BUSY_RECOVERY
    expect(toOpenError(new MigrationError('MIGRATION_FAILED', 'x', { cause: sqliteErr(5) })).code).toBe('BUSY');
    expect(toOpenError(sqliteErr(11)).code).toBe('CORRUPT');
    expect(toOpenError(sqliteErr(14)).code).toBe('IO');
    expect(toOpenError(new MigrationError('NEWER_SCHEMA', 'x')).code).toBe('NEWER_SCHEMA');
    expect(toOpenError(sqliteErr(5)).message_he).toContain('נעול');
  });

  it('openDatabaseWithRetry retries BUSY/IO and then succeeds', async () => {
    const sleeps: number[] = [];
    const retries: string[] = [];
    let calls = 0;
    const real = openDatabase(':memory:', { clock: mockClock(T0) });
    const db = await openDatabaseWithRetry(
      'x.db',
      { clock: mockClock(T0) },
      {
        attempts: 3,
        delayMs: 500,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        onRetry: ({ attempt, error }) => retries.push(`${attempt}:${error.code}`),
        open: () => {
          calls++;
          if (calls === 1) throw new DatabaseOpenError('BUSY', 'נעול');
          if (calls === 2) throw Object.assign(new Error('io'), { errcode: 10 });
          return real;
        },
      },
    );
    expect(db).toBe(real);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([500, 500]);
    expect(retries).toEqual(['1:BUSY', '2:IO']);
    db.close();
  });

  it('openDatabaseWithRetry gives up after the attempts and never retries CORRUPT / NEWER_SCHEMA', async () => {
    const sleep = async () => undefined;
    let calls = 0;
    await expect(
      openDatabaseWithRetry('x.db', { clock: mockClock(T0) }, {
        sleep,
        open: () => {
          calls++;
          throw new DatabaseOpenError('IO', 'io');
        },
      }),
    ).rejects.toMatchObject({ code: 'IO' });
    expect(calls).toBe(3); // ברירת המחדל: 3 ניסיונות

    for (const code of ['CORRUPT', 'NEWER_SCHEMA', 'MIGRATION_FAILED'] as const) {
      calls = 0;
      await expect(
        openDatabaseWithRetry('x.db', { clock: mockClock(T0) }, {
          sleep,
          open: () => {
            calls++;
            throw new DatabaseOpenError(code, 'x');
          },
        }),
      ).rejects.toMatchObject({ code });
      expect(calls).toBe(1);
    }

    // קובץ פגום אמיתי: נדחה מיד כ-CORRUPT, בלי המתנה
    const file = tmp.file('corrupt.db');
    writeFileSync(file, 'not a database '.repeat(80));
    const sleeps: number[] = [];
    await expect(
      openDatabaseWithRetry(file, { clock: mockClock(T0) }, { sleep: async (ms) => void sleeps.push(ms) }),
    ).rejects.toMatchObject({ code: 'CORRUPT' });
    expect(sleeps).toEqual([]);
  });

  it('openDatabaseWithRetry opens a real file with the default opener', async () => {
    const db = await openDatabaseWithRetry(tmp.file('ok.db'), { clock: mockClock(T0) });
    expect(db.tasks.create({ title: 'x', source: 'tool' }).title).toBe('x');
    db.close();
  });
});

describe('review fixes — repository helpers', () => {
  let clock: MockClock;
  let db: DataDatabase;
  beforeEach(() => {
    clock = mockClock(T0);
    db = openDatabase(':memory:', { clock, idFactory: mockIdFactory() });
  });
  afterEach(() => db.close());

  const addReminder = (text: string, dueAtUtc: string) =>
    db.reminders.create({ text, dueAtUtc, timezone: 'Asia/Jerusalem', dueLocal_he: 'x' });

  it('reminders.findScheduledExact matches normalized text + exact instant, scheduled only', () => {
    const r = addReminder('לשתות מים', '2026-10-06T07:00:00.000Z');
    expect(db.reminders.findScheduledExact('לשתות מים', '2026-10-06T07:00:00Z')?.id).toBe(r.id);
    expect(db.reminders.findScheduledExact('לִשְׁתּוֹת  מים!', '2026-10-06T07:00:00.000Z')?.id).toBe(r.id);
    expect(db.reminders.findScheduledExact('לשתות מים', '2026-10-06T07:01:00.000Z')).toBeNull();
    expect(db.reminders.findScheduledExact('לשתות מיץ', '2026-10-06T07:00:00.000Z')).toBeNull();
    expect(db.reminders.findScheduledExact('לשתות מים', 'garbage')).toBeNull();
    db.reminders.cancel(r.id);
    expect(db.reminders.findScheduledExact('לשתות מים', '2026-10-06T07:00:00.000Z')).toBeNull();
    expect(db.reminders.findClosedExact('לשתות מים')?.id).toBe(r.id);
    expect(db.reminders.findClosedExact('לשתות')).toBeNull();
  });

  it('reminders.findClosedExact ignores scheduled/missed and returns the most recently updated', () => {
    const a = addReminder('פגישה', '2026-10-05T06:00:00.000Z');
    const b = addReminder('פגישה', '2026-10-05T07:00:00.000Z');
    db.reminders.markMissed(a.id);
    expect(db.reminders.findClosedExact('פגישה')).toBeNull();
    db.reminders.markFired(b.id, T0);
    clock.advance(1000);
    db.reminders.acknowledge([a.id]);
    expect(db.reminders.findClosedExact('פגישה')?.id).toBe(a.id);
  });

  it('reminders.firedSince: status fired, fired_at >= since, chronological', () => {
    const a = addReminder('א', '2026-10-05T09:00:00.000Z');
    const b = addReminder('ב', '2026-10-05T09:30:00.000Z');
    const c = addReminder('ג', '2026-10-05T08:00:00.000Z');
    db.reminders.markFired(b.id, '2026-10-05T09:30:00.000Z');
    db.reminders.markFired(a.id, '2026-10-05T09:00:00.000Z');
    db.reminders.markMissed(c.id);
    expect(db.reminders.firedSince('2026-10-05T09:00:00.000Z').map((r) => r.id)).toEqual([a.id, b.id]);
    expect(db.reminders.firedSince('2026-10-05T09:00:00.001Z').map((r) => r.id)).toEqual([b.id]);
    db.reminders.acknowledge([b.id]);
    expect(db.reminders.firedSince('2026-10-05T00:00:00.000Z').map((r) => r.id)).toEqual([a.id]);
    expect(db.reminders.firedSince('nope')).toEqual([]);
  });

  it('tasks.findOpenExact matches normalized title and the same due date (NULL = NULL), open only', () => {
    const t = db.tasks.create({ title: 'לקנות חלב', dueDate: '2026-10-06', source: 'tool' });
    const n = db.tasks.create({ title: 'לקנות לחם', source: 'tool' });
    expect(db.tasks.findOpenExact('לקנות  חלב.', '2026-10-06')?.id).toBe(t.id);
    expect(db.tasks.findOpenExact('לקנות חלב', null)).toBeNull();
    expect(db.tasks.findOpenExact('לקנות חלב', '2026-10-07')).toBeNull();
    expect(db.tasks.findOpenExact('לקנות לחם', null)?.id).toBe(n.id);
    expect(db.tasks.findOpenExact('...', null)).toBeNull();
    db.tasks.complete(t.id);
    expect(db.tasks.findOpenExact('לקנות חלב', '2026-10-06')).toBeNull();
    expect(db.tasks.findClosedExact('לקנות חלב')?.id).toBe(t.id);
    expect(db.tasks.findClosedExact('לקנות לחם')).toBeNull();
  });

  it('history.appendTurn writes user + assistant atomically', () => {
    db.history.appendTurn([
      { turnId: 't1', role: 'user', text: 'שלום', mode: 'ai', createdAt: T0 },
      { turnId: 't1', role: 'assistant', text: 'היי', mode: 'ai', createdAt: 'not iso' },
    ]);
    expect(db.history.recent(5).map((e) => `${e.role}:${e.text}:${e.createdAt}`)).toEqual([
      `user:שלום:${T0}`,
      `assistant:היי:${T0}`,
    ]);
    // הרשומה השנייה נדחית (CHECK על role) — גם הראשונה לא נשמרת
    expect(() =>
      db.history.appendTurn([
        { turnId: 't2', role: 'user', text: 'שאלה', mode: 'ai', createdAt: T0 },
        { turnId: 't2', role: 'robot' as 'assistant', text: 'תשובה', mode: 'ai', createdAt: T0 },
      ]),
    ).toThrow();
    expect(db.history.recent(5).map((e) => e.turnId)).toEqual(['t1', 't1']);
    db.history.appendTurn([]);
    expect(db.history.recent(5)).toHaveLength(2);
  });

  it('actions.prune deletes entries older than the cutoff and keeps dedupe working', () => {
    const rec = (id: string, createdAt: string) =>
      db.actions.record({ id, turnId: 't', tool: 'create_task', paramsHash: 'h', status: 'succeeded', summary: '', createdAt });
    rec('old', '2026-10-03T10:00:00.000Z');
    rec('day', '2026-10-04T10:00:00.000Z');
    rec('new', '2026-10-05T09:59:00.000Z');
    expect(db.actions.prune('not a date')).toBe(0);
    expect(db.actions.prune(new Date(Date.parse(T0) - ACTION_LOG_RETENTION_MS).toISOString())).toBe(1);
    expect(db.actions.findRecentSuccess('create_task', 'h', '2026-10-05T09:58:00.000Z')?.id).toBe('new');
    expect(db.actions.findRecentSuccess('create_task', 'h', '2026-10-01T00:00:00.000Z')?.id).toBe('new');
    expect(db.actions.prune('2026-10-06T00:00:00.000Z')).toBe(2);
    expect(db.actions.findRecentSuccess('create_task', 'h', '2026-10-01T00:00:00.000Z')).toBeNull();
  });
});
