import { z } from "zod";

export const TASK_STATUSES = ["open", "in_progress", "done", "canceled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_TABS = ["mine", "team", "overdue", "today", "done"] as const;
export type TaskTab = (typeof TASK_TABS)[number];
export const REMINDER_OPTIONS = ["none", "at_due", "15m", "1h", "1d", "custom"] as const;
export type ReminderOption = (typeof REMINDER_OPTIONS)[number];

export const REMINDER_OFFSET_MINUTES: Record<Exclude<ReminderOption, "none" | "custom">, number> = {
  at_due: 0,
  "15m": 15,
  "1h": 60,
  "1d": 1440,
};

const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
const optionalUuid = z.preprocess(emptyToNull, z.uuid().nullable());
/** Wall-clock time in the tenant zone, "YYYY-MM-DDTHH:mm" (from <input type="datetime-local">). */
const localDateTime = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .nullable(),
);

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.preprocess(emptyToNull, z.string().trim().max(5000).nullable()).default(null),
    priority: z.enum(TASK_PRIORITIES).default("medium"),
    status: z.enum(["open", "in_progress"]).default("open"),
    dueAt: localDateTime.default(null),
    reminder: z.enum(REMINDER_OPTIONS).default("none"),
    remindAt: localDateTime.default(null),
    assigneeId: optionalUuid.default(null),
    isTeamTask: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
    contactId: optionalUuid.default(null),
    companyId: optionalUuid.default(null),
    dealId: optionalUuid.default(null),
    leadId: optionalUuid.default(null),
  })
  .refine((v) => v.reminder !== "custom" || v.remindAt !== null, { path: ["remindAt"], message: "validation.required" })
  .refine((v) => v.reminder === "none" || v.reminder === "custom" || v.dueAt !== null, {
    path: ["reminder"],
    message: "tasks.reminderNeedsDue",
  });
export type TaskInput = z.infer<typeof taskInputSchema>;

const dateKey = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
);

export const taskQuerySchema = z.object({
  tab: z.enum(TASK_TABS).default("mine"),
  q: z.string().trim().max(100).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignee: z.string().max(40).optional(),
  entity: z.enum(["contact", "company", "deal", "lead", "none"]).optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;

/** Lenient searchParams parsing: invalid values fall back to defaults. */
export function parseTaskQuery(params: Record<string, string | string[] | undefined>): TaskQuery {
  const flat = Object.fromEntries(
    Object.entries(params)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
      .filter(([, v]) => v !== "" && v !== undefined),
  );
  const parsed = taskQuerySchema.safeParse(flat);
  if (parsed.success) return parsed.data;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    const field = taskQuerySchema.shape[k as keyof typeof taskQuerySchema.shape];
    if (field && field.safeParse(v).success) cleaned[k] = v;
  }
  return taskQuerySchema.parse(cleaned);
}
