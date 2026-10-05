import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database, ToolDefinition } from '../../../src/main/core/contracts';
import type { ToolName } from '../../../src/shared/types';
import { defaultSettings } from '../../../src/shared/settings-schema';
import { openDatabase } from '../../../src/main/db/database';
import { createTaskTools, summarizeTasks } from '../../../src/main/tools/task-tools';
import { mockClock, mockIdFactory, mockToolContext, type MockClock } from './mock-helpers';

const T0 = '2026-10-05T10:00:00.000Z'; // יום שני, 13:00 בישראל
const TODAY = '2026-10-05';

describe('task tools', () => {
  let clock: MockClock;
  let db: Database;
  let tools: Map<ToolName, ToolDefinition>;
  const run = async (name: ToolName, input: unknown, ctx = mockToolContext(clock.now())) => {
    const tool = tools.get(name)!;
    const parsed = tool.inputSchema.parse(input);
    return { result: await tool.execute(parsed, ctx), ctx };
  };

  beforeEach(() => {
    clock = mockClock(T0);
    db = openDatabase(':memory:', { clock, idFactory: mockIdFactory('task') });
    tools = new Map(createTaskTools({ db, clock }).map((t) => [t.name, t]));
  });
  afterEach(() => db.close());

  it('declares names, risk, side effects and dedupe windows as specified', () => {
    expect([...tools.keys()]).toEqual(['create_task', 'list_tasks', 'complete_task']);
    expect(tools.get('create_task')).toMatchObject({ risk: 'low', sideEffect: true, dedupeWindowMs: 120_000 });
    expect(tools.get('list_tasks')).toMatchObject({ risk: 'read', sideEffect: false });
    expect(tools.get('complete_task')).toMatchObject({ risk: 'low', sideEffect: true, dedupeWindowMs: 0 });
    const samples: Record<string, unknown> = {
      create_task: { title: 'לקנות חלב' },
      list_tasks: { filter: 'today' },
      complete_task: { title_query: 'חלב' },
    };
    for (const t of tools.values()) {
      const input = t.inputSchema.parse(samples[t.name]);
      expect(t.title(input, defaultSettings())).toMatch(/[א-ת]/);
      const texts = t.describeForApproval(input, defaultSettings());
      expect(texts.action_he).toMatch(/[א-ת]/);
      expect(texts.target_he).toMatch(/[א-ת]/);
      expect(texts.impact_he).toMatch(/[א-ת]/);
    }
  });

  it('schemas are strict and enforce limits', () => {
    const create = tools.get('create_task')!.inputSchema;
    expect(create.safeParse({ title: 'x', extra: 1 }).success).toBe(false);
    expect(create.safeParse({ title: '' }).success).toBe(false);
    expect(create.safeParse({ title: 'a'.repeat(201) }).success).toBe(false);
    expect(create.safeParse({ title: 'x', due_date: '06/10/2026' }).success).toBe(false);
    expect(create.safeParse({ title: 'x', due_date: null, notes: null }).success).toBe(true);
    expect(create.safeParse({ title: 'x', notes: 'n'.repeat(1001) }).success).toBe(false);
    expect(tools.get('list_tasks')!.inputSchema.safeParse({ filter: 'week' }).success).toBe(false);
    expect(tools.get('complete_task')!.inputSchema.safeParse({ id: 'x' }).success).toBe(false);
  });

  it('create_task stores the task, emits data-changed and speaks a Hebrew summary', async () => {
    const { result, ctx } = await run('create_task', { title: 'לסיים את השרטוט', due_date: '2026-10-06' });
    expect(result).toMatchObject({ ok: true, status: 'success', summary_he: 'הוספתי משימה: לסיים את השרטוט — למחר.' });
    expect(result.data).toMatchObject({ id: 'task-1', title: 'לסיים את השרטוט', due_date: '2026-10-06' });
    expect(ctx.events).toEqual([{ type: 'data-changed', scope: 'tasks' }]);
    expect(db.tasks.get('task-1')).toMatchObject({ title: 'לסיים את השרטוט', status: 'open' });

    const today = await run('create_task', { title: 'לקנות חלב', due_date: TODAY });
    expect(today.result.summary_he).toBe('הוספתי משימה: לקנות חלב — להיום.');
    const far = await run('create_task', { title: 'להזמין חלקים', due_date: '2026-10-20' });
    expect(far.result.summary_he).toBe('הוספתי משימה: להזמין חלקים — ליום שלישי, 20 באוקטובר 2026.');
    const none = await run('create_task', { title: 'לסדר את השולחן' });
    expect(none.result.summary_he).toBe('הוספתי משימה: לסדר את השולחן.');
  });

  it('create_task rejects an impossible date and a blank title without writing', async () => {
    const bad = await run('create_task', { title: 'x', due_date: '2026-02-30' });
    expect(bad.result).toMatchObject({ ok: false, status: 'error', error_code: 'INVALID_PARAMS' });
    expect(bad.result.summary_he).toContain('2026-02-30');
    expect((await run('create_task', { title: '...' })).result.status).toBe('needs_clarification');
    const blank = await run('create_task', { title: '   ' });
    expect(blank.result).toMatchObject({ ok: false, status: 'needs_clarification', error_code: 'INVALID_PARAMS' });
    expect(blank.ctx.events).toEqual([]);
    expect(db.tasks.list('all', TODAY)).toEqual([]);
  });

  it('list_tasks today: empty, several, and more than five (only five read aloud)', async () => {
    expect((await run('list_tasks', { filter: 'today' })).result.summary_he).toBe('אין לך משימות פתוחות להיום.');

    db.tasks.create({ title: 'לקנות חלב', dueDate: TODAY, source: 'tool' });
    expect((await run('list_tasks', { filter: 'today' })).result.summary_he).toBe('יש לך משימה אחת להיום: לקנות חלב.');

    db.tasks.create({ title: 'לשלוח דוח', dueDate: '2026-10-01', source: 'tool' });
    db.tasks.create({ title: 'להתקשר לאמא', source: 'tool' });
    db.tasks.create({ title: 'משימה של מחר', dueDate: '2026-10-06', source: 'tool' });
    const three = (await run('list_tasks', { filter: 'today' })).result;
    expect(three.summary_he).toBe('יש לך 3 משימות להיום: לשלוח דוח, לקנות חלב ולהתקשר לאמא. אחת מהן באיחור.');
    expect((three.data as { count: number }).count).toBe(3);

    for (const t of ['א1', 'ב2', 'ג3', 'ד4']) db.tasks.create({ title: t, source: 'tool' });
    const seven = (await run('list_tasks', { filter: 'today' })).result.summary_he;
    expect(seven).toBe('יש לך 7 משימות להיום: לשלוח דוח, לקנות חלב, להתקשר לאמא, א1, ב2 ועוד 2. אחת מהן באיחור.');
  });

  it('list_tasks open / all summaries', async () => {
    expect((await run('list_tasks', { filter: 'open' })).result.summary_he).toBe('אין לך משימות פתוחות.');
    expect((await run('list_tasks', { filter: 'all' })).result.summary_he).toBe('אין לך משימות שמורות.');
    const a = db.tasks.create({ title: 'לקנות חלב', source: 'tool' });
    db.tasks.create({ title: 'EPLAN', source: 'tool' });
    db.tasks.complete(a.id);
    expect((await run('list_tasks', { filter: 'open' })).result.summary_he).toBe('יש לך משימה פתוחה אחת: EPLAN.');
    expect((await run('list_tasks', { filter: 'all' })).result.summary_he).toBe(
      'ברשימה 2 משימות: אחת פתוחה ואחת שבוצעה. הפתוחות: EPLAN.',
    );
  });

  it('summarizeTasks joins a non-Hebrew last item with ו-', () => {
    const mk = (title: string) => ({ id: title, title, notes: null, dueDate: null, status: 'open' as const, createdAt: T0, completedAt: null });
    expect(summarizeTasks('open', [mk('לקנות חלב'), mk('EPLAN')], TODAY)).toBe('יש לך 2 משימות פתוחות: לקנות חלב ו-EPLAN.');
  });

  it('complete_task by exact title marks done and emits data-changed', async () => {
    const t = db.tasks.create({ title: 'לסיים את השרטוט', source: 'tool' });
    db.tasks.create({ title: 'לשלוח דוח', source: 'tool' });
    const { result, ctx } = await run('complete_task', { title_query: 'לסיים את השרטוט' });
    expect(result).toMatchObject({ ok: true, summary_he: 'סימנתי את המשימה "לסיים את השרטוט" כבוצעה.' });
    expect(db.tasks.get(t.id)?.status).toBe('done');
    expect(ctx.events).toEqual([{ type: 'data-changed', scope: 'tasks' }]);
  });

  it('complete_task with an ambiguous query asks which one and changes nothing', async () => {
    const a = db.tasks.create({ title: 'לשלוח דוח לדני', source: 'tool' });
    const b = db.tasks.create({ title: 'לשלוח דוח לרונית', source: 'tool' });
    const { result, ctx } = await run('complete_task', { title_query: 'דוח' });
    expect(result).toMatchObject({ ok: false, status: 'needs_clarification', error_code: 'AMBIGUOUS' });
    expect(result.options?.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
    expect(result.summary_he).toContain('איזו מהן');
    expect(ctx.events).toEqual([]);
    expect(db.tasks.list('open', TODAY)).toHaveLength(2);

    // ההבהרה חוזרת עם task_id
    const second = await run('complete_task', { task_id: b.id });
    expect(second.result.ok).toBe(true);
    expect(db.tasks.get(b.id)?.status).toBe('done');
    expect(db.tasks.get(a.id)?.status).toBe('open');
  });

  it('complete_task never guesses on a weak partial match', async () => {
    const t = db.tasks.create({ title: 'לשלוח דוח', source: 'tool' });
    const { result } = await run('complete_task', { title_query: 'לשלוח מייל' });
    expect(result).toMatchObject({ ok: false, status: 'needs_clarification' });
    expect(result.options?.map((o) => o.id)).toEqual([t.id]);
    expect(db.tasks.get(t.id)?.status).toBe('open');
  });

  it('complete_task: not found, missing params, already done, cancelled signal', async () => {
    expect((await run('complete_task', { title_query: 'משהו שלא קיים' })).result).toMatchObject({ ok: false, error_code: 'NOT_FOUND' });
    expect((await run('complete_task', { task_id: 'missing' })).result).toMatchObject({ ok: false, error_code: 'NOT_FOUND' });
    expect((await run('complete_task', {})).result).toMatchObject({ ok: false, status: 'needs_clarification' });

    const t = db.tasks.create({ title: 'לקנות חלב', source: 'tool' });
    db.tasks.complete(t.id);
    const again = await run('complete_task', { task_id: t.id });
    expect(again.result).toMatchObject({ ok: true, summary_he: 'המשימה "לקנות חלב" כבר מסומנת כבוצעה.' });
    expect(again.ctx.events).toEqual([]);

    const aborted = await run('create_task', { title: 'x' }, mockToolContext(clock.now(), { aborted: true }));
    expect(aborted.result).toMatchObject({ ok: false, status: 'cancelled', error_code: 'CANCELLED' });
    expect(db.tasks.search('x')).toEqual([]);
  });

  it('a database failure becomes a Hebrew INTERNAL error, not an exception', async () => {
    db.close();
    const { result } = await run('create_task', { title: 'x' });
    expect(result).toMatchObject({ ok: false, status: 'error', error_code: 'INTERNAL' });
    expect(result.summary_he).toContain('נכשלה');
    db = openDatabase(':memory:', { clock }); // ל-afterEach
  });
});
