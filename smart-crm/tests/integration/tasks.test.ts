import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, schema } from "@/server/db";
import { AppError } from "@/server/errors";
import { systemCtx } from "@/server/context";
import { taskInputSchema, taskQuerySchema } from "@/modules/tasks/schemas";
import { computeSchedule, createTask, deleteTask, getTask, listTasks, setTaskStatus, taskCounts, updateTask } from "@/modules/tasks/service";
import { processDueReminders } from "@/modules/tasks/jobs";
import { savePreference } from "@/app/(app)/settings/notifications/preferences";
import { createTeam } from "../support/factories";

type Team = Awaited<ReturnType<typeof createTeam>>;
let T: Team;
let Other: Team;
let contactId: string;
let foreignContactId: string;

const input = (v: Record<string, unknown>) => taskInputSchema.parse(v);
const q = (v: Record<string, unknown> = {}) => taskQuerySchema.parse(v);

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

async function eventsFor(entityId: string, type: string) {
  const [{ n }] = await db().execute<{ n: number }>(
    sql`select count(*)::int as n from public.jobs where type = 'events.dispatch' and payload->>'entityId' = ${entityId} and payload->>'type' = ${type}`,
  );
  return n;
}

beforeAll(async () => {
  T = await createTeam("Tasks Co");
  Other = await createTeam("Other Tasks Co");
  const [c] = await db().insert(schema.contacts).values({ tenantId: T.tenant.id, firstName: "דנה", lastName: "כהן" }).returning();
  contactId = c.id;
  const [f] = await db().insert(schema.contacts).values({ tenantId: Other.tenant.id, firstName: "Foreign" }).returning();
  foreignContactId = f.id;
});
afterAll(async () => {
  await closeDb();
});

describe("task input", () => {
  it("requires a title and a due date for relative reminders", () => {
    expect(taskInputSchema.safeParse({ title: "" }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "x", reminder: "1h" }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "x", reminder: "custom" }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "x", dueAt: "2026-10-20T10:00", reminder: "1h" }).success).toBe(true);
  });

  it("interprets due times in the tenant zone and computes reminders across DST", () => {
    // 2026-10-26 is after Israel falls back (UTC+2); 1 day before is still UTC+3.
    const s = computeSchedule(input({ title: "x", dueAt: "2026-10-26T09:00", reminder: "1d" }), "Asia/Jerusalem");
    expect(s.dueAt?.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(s.remindAt?.toISOString()).toBe("2026-10-25T07:00:00.000Z");
    const custom = computeSchedule(input({ title: "x", reminder: "custom", remindAt: "2026-10-24T08:30" }), "Asia/Jerusalem");
    expect(custom.remindAt?.toISOString()).toBe("2026-10-24T05:30:00.000Z");
  });
});

describe("tasks service", () => {
  it("creates a task linked to a contact: activity, event and audit", async () => {
    const task = await createTask(T.agentCtx, input({ title: "להתקשר לדנה", contactId, dueAt: "2030-01-01T10:00", priority: "high" }));
    expect(task).toMatchObject({ assigneeId: T.agent.id, status: "open", priority: "high", source: "manual" });
    const activities = await db().select().from(schema.activities).where(and(eq(schema.activities.contactId, contactId), eq(schema.activities.type, "task_created")));
    expect(activities.length).toBeGreaterThanOrEqual(1);
    expect(await eventsFor(task.id, "task.created")).toBe(1);
    const audits = await db().select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, task.id));
    expect(audits.map((a) => a.action)).toContain("task.created");
    const item = await getTask(T.agentCtx, task.id);
    expect(item.link).toMatchObject({ kind: "contact", id: contactId, name: "דנה כהן" });
  });

  it("enforces assignment rules by role and notifies the assignee", async () => {
    await expectAppError(createTask(T.agentCtx, input({ title: "x", assigneeId: T.manager.id })), "FORBIDDEN");
    const t = await createTask(T.managerCtx, input({ title: "משימה לנציג", assigneeId: T.agent.id }));
    expect(t.assigneeId).toBe(T.agent.id);
    const notes = await db().select().from(schema.notifications).where(and(eq(schema.notifications.userId, T.agent.id), eq(schema.notifications.type, "task_assigned")));
    expect(notes.some((n) => n.link === `/tasks?task=${t.id}`)).toBe(true);
    // Agents cannot reassign a task away from someone else either.
    const managers = await createTask(T.managerCtx, input({ title: "של המנהל" }));
    await expectAppError(updateTask(T.agentCtx, managers.id, input({ title: "שלי עכשיו", assigneeId: T.agent.id })), "FORBIDDEN");
    // Team tasks may be unassigned.
    const team = await createTask(T.agentCtx, input({ title: "משימת צוות", isTeamTask: true }));
    expect(team.assigneeId).toBeNull();
  });

  it("rejects non-member assignees and links to other tenants", async () => {
    await expectAppError(createTask(T.ownerCtx, input({ title: "x", assigneeId: Other.owner.id })), "VALIDATION");
    await expectAppError(createTask(T.ownerCtx, input({ title: "x", contactId: foreignContactId })), "VALIDATION");
  });

  it("isolates tenants", async () => {
    const foreign = await createTask(Other.ownerCtx, input({ title: "Foreign task" }));
    await expectAppError(getTask(T.ownerCtx, foreign.id), "NOT_FOUND");
    await expectAppError(setTaskStatus(T.ownerCtx, foreign.id, "done"), "NOT_FOUND");
    const team = await listTasks(T.ownerCtx, q({ tab: "team" }));
    expect(team.rows.some((r) => r.id === foreign.id)).toBe(false);
  });

  it("completes and reopens with activity + event; agents cannot delete", async () => {
    const t = await createTask(T.agentCtx, input({ title: "לסיים", contactId }));
    const done = await setTaskStatus(T.agentCtx, t.id, "done");
    expect(done.completedAt).not.toBeNull();
    expect(done.completedBy).toBe(T.agent.id);
    expect(await eventsFor(t.id, "task.completed")).toBe(1);
    const completedActivities = await db()
      .select()
      .from(schema.activities)
      .where(and(eq(schema.activities.contactId, contactId), eq(schema.activities.type, "task_completed")));
    expect(completedActivities.some((a) => a.metadata.taskId === t.id)).toBe(true);
    const reopened = await setTaskStatus(T.agentCtx, t.id, "open");
    expect(reopened.completedAt).toBeNull();
    await expectAppError(deleteTask(T.agentCtx, t.id), "FORBIDDEN");
    await deleteTask(T.managerCtx, t.id);
    await expectAppError(getTask(T.managerCtx, t.id), "NOT_FOUND");
  });

  it("lists by tab: mine, today, overdue, done", async () => {
    const team = await createTeam("Tabs Co");
    const now = new Date("2026-10-19T09:00:00Z"); // 12:00 in Jerusalem
    const overdue = await createTask(team.agentCtx, input({ title: "overdue", dueAt: "2026-10-18T10:00" }));
    const today = await createTask(team.agentCtx, input({ title: "today", dueAt: "2026-10-19T18:00" }));
    const lateTonight = await createTask(team.agentCtx, input({ title: "tonight", dueAt: "2026-10-19T23:30" }));
    const tomorrow = await createTask(team.agentCtx, input({ title: "tomorrow", dueAt: "2026-10-20T00:30" }));
    const doneTask = await createTask(team.agentCtx, input({ title: "done" }));
    await setTaskStatus(team.agentCtx, doneTask.id, "done");
    const ids = async (tab: string) => (await listTasks(team.agentCtx, q({ tab }), now)).rows.map((r) => r.id);
    expect(await ids("today")).toEqual([today.id, lateTonight.id]);
    expect(await ids("overdue")).toEqual([overdue.id]);
    expect(await ids("done")).toEqual([doneTask.id]);
    expect((await ids("mine")).sort()).toEqual([overdue.id, today.id, lateTonight.id, tomorrow.id].sort());
    const counts = await taskCounts(team.agentCtx, now);
    expect(counts).toMatchObject({ overdue: 1, today: 2, mine: 4, mineOverdue: 1 });
    const filtered = await listTasks(team.agentCtx, q({ tab: "team", from: "2026-10-20", to: "2026-10-20" }), now);
    expect(filtered.rows.map((r) => r.id)).toEqual([tomorrow.id]);
  });
});

describe("reminders", () => {
  it("delivers each due reminder exactly once under concurrent workers", async () => {
    const team = await createTeam("Reminder Co");
    const past = "2020-01-01T09:00";
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const t = await createTask(team.agentCtx, input({ title: `r${i}`, dueAt: past, reminder: "at_due" }));
      ids.push(t.id);
    }
    const [a, b, c] = await Promise.all([processDueReminders(), processDueReminders(), processDueReminders()]);
    const claimedMine = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from public.notifications where tenant_id = ${team.tenant.id} and type = 'task_reminder'`,
    );
    expect(Number(claimedMine[0].n)).toBe(12);
    expect(a + b + c).toBeGreaterThanOrEqual(12);
    expect(await processDueReminders()).toBe(0);
    const rows = await db().select().from(schema.tasks).where(eq(schema.tasks.tenantId, team.tenant.id));
    expect(rows.every((r) => r.reminderSentAt !== null)).toBe(true);
  });

  it("queues an email only when the user enabled email reminders", async () => {
    const team = await createTeam("Email Pref Co");
    const quiet = await createTask(team.agentCtx, input({ title: "quiet", dueAt: "2020-01-01T09:00", reminder: "at_due" }));
    await processDueReminders();
    const [{ n: before }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.jobs where type = 'tasks.reminder_email' and payload->>'taskId' = ${quiet.id}`);
    expect(Number(before)).toBe(0);

    await savePreference(team.agentCtx, { eventType: "task_reminder", inApp: false, email: true });
    const loud = await createTask(team.agentCtx, input({ title: "loud", dueAt: "2020-01-01T09:00", reminder: "at_due" }));
    await processDueReminders();
    const [{ n: emails }] = await db().execute<{ n: number }>(sql`select count(*)::int as n from public.jobs where type = 'tasks.reminder_email' and payload->>'taskId' = ${loud.id}`);
    expect(Number(emails)).toBe(1);
    const inApp = await db().select().from(schema.notifications).where(and(eq(schema.notifications.userId, team.agent.id), eq(schema.notifications.link, `/tasks?task=${loud.id}`)));
    expect(inApp).toEqual([]);
  });

  it("re-arms the reminder when its time changes and skips completed tasks", async () => {
    const team = await createTeam("Rearm Co");
    const t = await createTask(team.agentCtx, input({ title: "rearm", dueAt: "2020-01-01T09:00", reminder: "at_due" }));
    await processDueReminders();
    await updateTask(team.agentCtx, t.id, input({ title: "rearm", dueAt: "2020-01-02T09:00", reminder: "at_due" }));
    const [row] = await db().select().from(schema.tasks).where(eq(schema.tasks.id, t.id));
    expect(row.reminderSentAt).toBeNull();
    await setTaskStatus(team.agentCtx, t.id, "done");
    await processDueReminders();
    const [after] = await db().select().from(schema.tasks).where(eq(schema.tasks.id, t.id));
    expect(after.reminderSentAt).toBeNull();
  });

  it("system contexts (automations) can create tasks", async () => {
    const team = await createTeam("System Co");
    const t = await createTask(systemCtx(team.tenant.id, { actorType: "automation" }), input({ title: "auto", assigneeId: team.agent.id }));
    expect(t).toMatchObject({ source: "automation", assigneeId: team.agent.id });
  });
});
