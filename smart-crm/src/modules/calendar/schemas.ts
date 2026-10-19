import { z } from "zod";

const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
const optionalUuid = z.preprocess(emptyToNull, z.uuid().nullable());

export const CALENDAR_VIEWS = ["month", "week", "day", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/**
 * Event times arrive as wall-clock values in the tenant zone: "YYYY-MM-DDTHH:mm"
 * for timed events, "YYYY-MM-DD" (inclusive start/end days) for all-day events.
 */
export const eventInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.preprocess(emptyToNull, z.string().trim().max(5000).nullable()).default(null),
    location: z.preprocess(emptyToNull, z.string().trim().max(300).nullable()).default(null),
    allDay: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
    start: z.string().trim().min(1),
    end: z.string().trim().min(1),
    ownerId: optionalUuid.default(null),
    contactId: optionalUuid.default(null),
    companyId: optionalUuid.default(null),
    dealId: optionalUuid.default(null),
  })
  .superRefine((v, ctx) => {
    const re = v.allDay ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    if (!re.test(v.start)) ctx.addIssue({ code: "custom", path: ["start"], message: "validation.invalid" });
    if (!re.test(v.end)) ctx.addIssue({ code: "custom", path: ["end"], message: "validation.invalid" });
  });
export type EventInput = z.infer<typeof eventInputSchema>;

export const rangeQuerySchema = z.object({
  view: z.enum(CALENDAR_VIEWS).default("month"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  mine: z.enum(["1", "0"]).optional(),
});
