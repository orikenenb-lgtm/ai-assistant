import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  let onCreated: ReturnType<typeof vi.fn>;
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
    onCreated = vi.fn();
    tools = new Map(createReminderTools({ db, clock, onCreated }).map((t) => [t.name, t]));
  });
  afterEach(() => db.close());

  it('declares names, risk, side effects and dedupe windows as specified', () => {
    expect([...tools.keys()]).toEqual(['create_reminder', 'list_reminders', 'cancel_reminder']);
    expect(tools.get('create_reminder')).toMatchObject({ risk: 'low', sideEffect: true, dedupeWindowMs: 120_000 });
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
