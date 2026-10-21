import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Database, ToolDefinition } from '../../../src/main/core/contracts';
import type { ToolName } from '../../../src/shared/types';
import { openDatabase } from '../../../src/main/db/database';
import { createReminderTools } from '../../../src/main/tools/reminder-tools';
import { formatHebrewFull } from '../../../src/main/time/time';
import { mockClock, mockIdFactory, mockToolContext, type MockClock } from './mock-helpers';

const T0 = '2026-10-05T10:00:00.000Z'; // יום שני 5.10.2026, 13:00 בישראל

describe('reminder tools', () => {
  let clock: MockClock;
  let db: Database;
  let onCreated: Mock<() => void>;
  let tools: Map<ToolName, ToolDefinition>;
  const run = async (name: ToolName, input: unknown, ctx = mockToolContext(clock.now())) => {
    const tool = tools.get(name)!;
    const parsed = tool.inputSchema.parse(input);
    return { result: await tool.execute(parsed, ctx), ctx };
  };
  const addReminder = (text: string, dueIso: string) =>
    db.reminders.create({ text, dueAtUtc: dueIso, timezone: 'Asia/Jerusalem', dueLocal_he: formatHebrewFull(dueIso) });

  beforeEach(() => {
    clock = mockClock(T0);
    db = openDatabase(':memory:', { clock, idFactory: mockIdFactory('rem') });
    onCreated = vi.fn<() => void>();
    tools = new Map(createReminderTools({ db, clock, onCreated }).map((t) => [t.name, t]));
  });
  afterEach(() => db.close());

  it('declares names, risk, side effects and dedupe windows as specified', () => {
    expect([...tools.keys()]).toEqual(['create_reminder', 'list_reminders', 'cancel_reminder']);
    // create_reminder אידמפוטנטי לפי מצב בתוך הכלי — לא לפי חלון זמן של המנוע
    expect(tools.get('create_reminder')).toMatchObject({ risk: 'low', sideEffect: true, dedupeWindowMs: 0 });
    expect(tools.get('list_reminders')).toMatchObject({ risk: 'read', sideEffect: false });
    expect(tools.get('cancel_reminder')).toMatchObject({ risk: 'low', sideEffect: true });
  });

  it('schemas are strict', () => {
    const s = tools.get('create_reminder')!.inputSchema;
    expect(s.safeParse({ text: 'x', date: '2026-10-06', time: '08:00' }).success).toBe(true);
    expect(s.safeParse({ text: 'x', date: '2026-10-06', time: '08:00', when: 'now' }).success).toBe(false);
    expect(s.safeParse({ text: 'x', date: '06/10/2026', time: '08:00' }).success).toBe(false);
    expect(s.safeParse({ text: 'x', date: '2026-10-06', time: '8 בבוקר' }).success).toBe(false);
    expect(s.safeParse({ text: 'a'.repeat(301), date: '2026-10-06', time: '08:00' }).success).toBe(false);
    expect(tools.get('cancel_reminder')!.inputSchema.safeParse({ id: 'x' }).success).toBe(false);
  });

  it('create_reminder: exact spoken summary, stored row, data, data-changed and scheduler re-arm', async () => {
    const { result, ctx } = await run('create_reminder', { text: 'לפתוח את הפרויקט', date: '2026-10-06', time: '08:00' });
    expect(result).toMatchObject({
      ok: true,
      status: 'success',
      summary_he: 'קבעתי תזכורת: לפתוח את הפרויקט — יום שלישי, 6 באוקטובר 2026 בשעה 08:00.',
      data: {
        id: 'rem-1',
        due_local_full: 'יום שלישי, 6 באוקטובר 2026 בשעה 08:00',
        due_utc: '2026-10-06T05:00:00.000Z',
      },
    });
    expect(db.reminders.get('rem-1')).toMatchObject({
      text: 'לפתוח את הפרויקט',
      dueAtUtc: '2026-10-06T05:00:00.000Z',
      timezone: 'Asia/Jerusalem',
      dueLocal_he: 'יום שלישי, 6 באוקטובר 2026 בשעה 08:00',
      status: 'scheduled',
    });
    expect(ctx.events).toEqual([{ type: 'data-changed', scope: 'reminders' }]);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('create_reminder rejects a past time with PAST_TIME and writes nothing', async () => {
    const { result, ctx } = await run('create_reminder', { text: 'לשתות מים', date: '2026-10-05', time: '12:59' });
    expect(result).toMatchObject({ ok: false, error_code: 'PAST_TIME' });
    expect(result.summary_he).toBe('המועד הזה כבר עבר (יום שני, 5 באוקטובר 2026 בשעה 12:59). לאיזה מועד לקבוע?');
    expect(ctx.events).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();
    expect(db.reminders.list('all')).toEqual([]);
  });

  it('create_reminder: the current minute itself counts as past', async () => {
    const { result } = await run('create_reminder', { text: 'עכשיו', date: '2026-10-05', time: '13:00' });
    expect(result.error_code).toBe('PAST_TIME');
  });

  it('create_reminder: DST gap and overlap become clarifications; dst_choice resolves the overlap', async () => {
    clock.set('2026-03-01T10:00:00.000Z');
    const gap = await run('create_reminder', { text: 'בדיקה', date: '2026-03-27', time: '02:30' });
    expect(gap.result).toMatchObject({ ok: false, status: 'needs_clarification', error_code: 'DST_GAP' });
    expect(gap.result.options?.[0]?.id).toBe('03:30');

    const overlap = await run('create_reminder', { text: 'בדיקה', date: '2026-10-25', time: '01:30' });
    expect(overlap.result).toMatchObject({ ok: false, status: 'needs_clarification', error_code: 'DST_AMBIGUOUS' });
    expect(overlap.result.options?.map((o) => o.id)).toEqual(['earlier', 'later']);
    expect(db.reminders.list('all')).toEqual([]);

    const later = await run('create_reminder', { text: 'בדיקה', date: '2026-10-25', time: '01:30', dst_choice: 'later' });
    expect(later.result.ok).toBe(true);
    expect(later.result.data).toMatchObject({ due_utc: '2026-10-24T23:30:00.000Z' });
    expect(later.result.summary_he).toContain('שעון חורף');
  });

  it('create_reminder: impossible date -> INVALID_PARAMS in Hebrew', async () => {
    const { result } = await run('create_reminder', { text: 'x', date: '2026-02-30', time: '08:00' });
    expect(result).toMatchObject({ ok: false, status: 'error', error_code: 'INVALID_PARAMS' });
    expect(result.summary_he).toMatch(/[א-ת]/);
    const badHour = await run('create_reminder', { text: 'x', date: '2026-10-06', time: '25:00' });
    expect(badHour.result.error_code).toBe('INVALID_PARAMS');
    const noText = await run('create_reminder', { text: '?!', date: '2026-10-06', time: '08:00' });
    expect(noText.result).toMatchObject({ status: 'needs_clarification', summary_he: 'על מה להזכיר לך?' });
    expect(db.reminders.list('all')).toEqual([]);
  });

  it('list_reminders summaries (upcoming with today/tomorrow wording, missed, all)', async () => {
    expect((await run('list_reminders', { filter: 'upcoming' })).result.summary_he).toBe('אין לך תזכורות קרובות.');
    expect((await run('list_reminders', { filter: 'missed' })).result.summary_he).toBe('אין תזכורות שהוחמצו.');
    expect((await run('list_reminders', { filter: 'all' })).result.summary_he).toBe('אין לך תזכורות שמורות.');

    addReminder('לשתות מים', '2026-10-05T15:00:00.000Z');
    addReminder('לפתוח את הפרויקט', '2026-10-06T05:00:00.000Z');
    const missed = addReminder('פגישה', '2026-10-05T06:00:00.000Z');
    db.reminders.markMissed(missed.id);

    const upcoming = (await run('list_reminders', { filter: 'upcoming' })).result;
    expect(upcoming.summary_he).toBe(
      'יש לך 2 תזכורות קרובות: לשתות מים — היום בשעה 18:00; ולפתוח את הפרויקט — מחר בשעה 08:00.',
    );
    expect((upcoming.data as { reminders: unknown[] }).reminders).toHaveLength(2);
    expect((await run('list_reminders', { filter: 'missed' })).result.summary_he).toBe(
      'הוחמצה תזכורת אחת: פגישה — יום שני, 5 באוקטובר 2026 בשעה 09:00.',
    );
    expect((await run('list_reminders', { filter: 'all' })).result.summary_he).toBe(
      'ברשימה 3 תזכורות: 2 קרובות ואחת שהוחמצה. הקרובות: לשתות מים — היום בשעה 18:00; ולפתוח את הפרויקט — מחר בשעה 08:00.',
    );
  });

  it('cancel_reminder by text sets status cancelled (kept in the list) and emits data-changed', async () => {
    const water = addReminder('לשתות מים', '2026-10-05T15:00:00.000Z');
    addReminder('לפתוח את הפרויקט', '2026-10-06T05:00:00.000Z');
    const { result, ctx } = await run('cancel_reminder', { text_query: 'לשתות מים' });
    expect(result).toMatchObject({
      ok: true,
      summary_he: 'ביטלתי את התזכורת: לשתות מים (יום שני, 5 באוקטובר 2026 בשעה 18:00).',
    });
    expect(db.reminders.get(water.id)?.status).toBe('cancelled');
    expect(db.reminders.list('all').map((r) => r.id)).toContain(water.id);
    expect(ctx.events).toEqual([{ type: 'data-changed', scope: 'reminders' }]);

    const again = await run('cancel_reminder', { reminder_id: water.id });
    expect(again.result).toMatchObject({ ok: true, summary_he: 'התזכורת "לשתות מים" כבר בוטלה.' });
  });

  it('cancel_reminder with several matches asks which one', async () => {
    const a = addReminder('לשתות מים', '2026-10-05T15:00:00.000Z');
    const b = addReminder('לשתות מים', '2026-10-05T17:00:00.000Z');
    const { result, ctx } = await run('cancel_reminder', { text_query: 'מים' });
    expect(result).toMatchObject({ ok: false, status: 'needs_clarification', error_code: 'AMBIGUOUS' });
    expect(result.options?.map((o) => o.id)).toEqual([a.id, b.id]);
    expect(result.options?.[0]?.label).toBe('לשתות מים — יום שני, 5 באוקטובר 2026 בשעה 18:00');
    expect(ctx.events).toEqual([]);
    expect(db.reminders.list('upcoming')).toHaveLength(2);
  });

  it('cancel_reminder: already fired, not found, no params', async () => {
    const r = addReminder('פגישה', '2026-10-05T09:00:00.000Z');
    db.reminders.markFired(r.id, T0);
    const fired = await run('cancel_reminder', { reminder_id: r.id });
    expect(fired.result).toMatchObject({ ok: false, error_code: 'INVALID_PARAMS' });
    expect(fired.result.summary_he).toContain('כבר הוצגה');
    expect(db.reminders.get(r.id)?.status).toBe('fired');
    expect((await run('cancel_reminder', { text_query: 'לא קיימת בכלל' })).result.error_code).toBe('NOT_FOUND');
    expect((await run('cancel_reminder', {})).result.status).toBe('needs_clarification');
  });

  it('an aborted turn does not create anything', async () => {
    const { result } = await run(
      'create_reminder',
      { text: 'x', date: '2026-10-06', time: '08:00' },
      mockToolContext(clock.now(), { aborted: true }),
    );
    expect(result.status).toBe('cancelled');
    expect(db.reminders.list('all')).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe('reminder tools — state-based idempotency, wrong target, missed vs fired', () => {
  let clock: MockClock;
  let db: Database;
  let onCreated: Mock<() => void>;
  let tools: Map<ToolName, ToolDefinition>;
  const run = async (name: ToolName, input: unknown, ctx = mockToolContext(clock.now())) => {
    const tool = tools.get(name)!;
    return { result: await tool.execute(tool.inputSchema.parse(input), ctx), ctx };
  };
  const addReminder = (text: string, dueIso: string) =>
    db.reminders.create({ text, dueAtUtc: dueIso, timezone: 'Asia/Jerusalem', dueLocal_he: formatHebrewFull(dueIso) });

  beforeEach(() => {
    clock = mockClock(T0);
    db = openDatabase(':memory:', { clock, idFactory: mockIdFactory('rem') });
    onCreated = vi.fn<() => void>();
    tools = new Map(createReminderTools({ db, clock, onCreated }).map((t) => [t.name, t]));
  });
  afterEach(() => db.close());

  it('create -> cancel -> create again within seconds schedules a new reminder (not swallowed)', async () => {
    const water = { text: 'לשתות מים', date: '2026-10-06', time: '10:00' };
    expect((await run('create_reminder', water)).result.status).toBe('success');
    clock.advance(10_000);
    expect((await run('cancel_reminder', { text_query: 'לשתות מים' })).result.ok).toBe(true);
    clock.advance(10_000);
    const again = await run('create_reminder', water);
    expect(again.result).toMatchObject({ ok: true, status: 'success' });
    expect(db.reminders.list('upcoming').map((r) => r.text)).toEqual(['לשתות מים']);
    expect(db.reminders.list('all').map((r) => r.status).sort()).toEqual(['cancelled', 'scheduled']);
  });

  it('the same text at the same time while still scheduled is deduplicated by state', async () => {
    const first = await run('create_reminder', { text: 'לשתות מים', date: '2026-10-06', time: '10:00' });
    const again = await run('create_reminder', { text: 'לשתות  מים.', date: '2026-10-06', time: '10:00' });
    expect(again.result).toMatchObject({
      ok: true,
      status: 'deduplicated',
      summary_he: 'התזכורת הזו כבר קיימת: לשתות מים — יום שלישי, 6 באוקטובר 2026 בשעה 10:00 — לא יצרתי כפילות.',
      data: {
        id: (first.result.data as { id: string }).id,
        due_local_full: 'יום שלישי, 6 באוקטובר 2026 בשעה 10:00',
        due_utc: '2026-10-06T07:00:00.000Z',
      },
    });
    expect(again.ctx.events).toEqual([]);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(db.reminders.list('all')).toHaveLength(1);
    // אותו טקסט בשעה אחרת — תזכורת נוספת
    expect((await run('create_reminder', { text: 'לשתות מים', date: '2026-10-06', time: '11:00' })).result.status).toBe('success');
    expect(db.reminders.list('upcoming')).toHaveLength(2);
  });

  it('cancel "Daniel" never cancels "Daniela": asks with options', async () => {
    const daniela = addReminder('להתקשר לדניאלה', '2026-10-05T15:00:00.000Z');
    const { result, ctx } = await run('cancel_reminder', { text_query: 'להתקשר לדניאל' });
    expect(result).toMatchObject({ ok: false, status: 'needs_clarification', error_code: 'AMBIGUOUS' });
    expect(result.options?.map((o) => o.id)).toEqual([daniela.id]);
    expect(ctx.events).toEqual([]);
    expect(db.reminders.get(daniela.id)?.status).toBe('scheduled');
  });

  it('cancelling the same reminder twice answers "already cancelled" instead of hitting the sibling', async () => {
    const daniel = addReminder('להתקשר לדניאל', '2026-10-05T15:00:00.000Z');
    const daniela = addReminder('להתקשר לדניאלה', '2026-10-05T16:00:00.000Z');
    expect((await run('cancel_reminder', { text_query: 'להתקשר לדניאל' })).result.ok).toBe(true);
    const second = await run('cancel_reminder', { text_query: 'להתקשר לדניאל' });
    expect(second.result).toMatchObject({ ok: true, summary_he: 'התזכורת "להתקשר לדניאל" כבר בוטלה.' });
    expect(second.ctx.events).toEqual([]);
    expect(db.reminders.get(daniel.id)?.status).toBe('cancelled');
    expect(db.reminders.get(daniela.id)?.status).toBe('scheduled');

    // וגם תזכורת שכבר הופעלה — "כבר הוצגה", לא ביטול של אחות
    const ori = addReminder('לשלוח לאורי', '2026-10-05T09:00:00.000Z');
    const orit = addReminder('לשלוח לאורית', '2026-10-05T17:00:00.000Z');
    db.reminders.markFired(ori.id, T0);
    const fired = await run('cancel_reminder', { text_query: 'לשלוח לאורי' });
    expect(fired.result).toMatchObject({ ok: false, error_code: 'INVALID_PARAMS' });
    expect(fired.result.summary_he).toContain('כבר הוצגה');
    expect(db.reminders.get(orit.id)?.status).toBe('scheduled');
  });

  it('acknowledged keeps missed vs fired apart (fired_at IS NULL = missed) in summaries and cancel', async () => {
    const missed = addReminder('פגישה', '2026-10-05T06:00:00.000Z');
    const fired = addReminder('לשתות מים', '2026-10-05T09:00:00.000Z');
    db.reminders.markMissed(missed.id);
    db.reminders.markFired(fired.id, '2026-10-05T09:00:00.000Z');
    expect(db.reminders.acknowledge([missed.id, fired.id])).toBe(2);

    const all = await run('list_reminders', { filter: 'all' });
    expect(all.result.summary_he).toBe('ברשימה 2 תזכורות: אחת שהוחמצה ואחת שכבר הופעלה.');
    const data = (all.result.data as { reminders: Array<{ id: string; fired_at: string | null }> }).reminders;
    expect(data.find((r) => r.id === missed.id)?.fired_at).toBeNull();
    expect(data.find((r) => r.id === fired.id)?.fired_at).toBe('2026-10-05T09:00:00.000Z');

    const cancelMissed = await run('cancel_reminder', { reminder_id: missed.id });
    expect(cancelMissed.result.summary_he).toBe(
      'התזכורת "פגישה" הוחמצה (יום שני, 5 באוקטובר 2026 בשעה 09:00) וכבר סומנה כנקראה, אין מה לבטל.',
    );
    const cancelFired = await run('cancel_reminder', { reminder_id: fired.id });
    expect(cancelFired.result.summary_he).toBe('התזכורת "לשתות מים" כבר הוצגה (יום שני, 5 באוקטובר 2026 בשעה 12:00), אין מה לבטל.');
  });

  it('works through the plain repository contract too (fallback when the extra helpers are absent)', async () => {
    const r = db.reminders;
    const contractOnly: Database = {
      ...db,
      reminders: {
        create: r.create,
        list: r.list,
        get: r.get,
        cancel: r.cancel,
        search: r.search,
        dueScheduled: r.dueScheduled,
        markFired: r.markFired,
        markMissed: r.markMissed,
        acknowledge: r.acknowledge,
        listMissedUnacknowledged: r.listMissedUnacknowledged,
      },
    };
    tools = new Map(createReminderTools({ db: contractOnly, clock }).map((t) => [t.name, t]));
    const input = { text: 'להתקשר לדניאל', date: '2026-10-06', time: '10:00' };
    expect((await run('create_reminder', input)).result.status).toBe('success');
    expect((await run('create_reminder', input)).result.status).toBe('deduplicated');
    addReminder('להתקשר לדניאלה', '2026-10-06T08:00:00.000Z');
    expect((await run('cancel_reminder', { text_query: 'להתקשר לדניאל' })).result.ok).toBe(true);
    const second = await run('cancel_reminder', { text_query: 'להתקשר לדניאל' });
    expect(second.result.summary_he).toBe('התזכורת "להתקשר לדניאל" כבר בוטלה.');
    expect(db.reminders.list('upcoming').map((x) => x.text)).toEqual(['להתקשר לדניאלה']);
  });
});
