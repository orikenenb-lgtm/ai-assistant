import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { listCalendarRange } from "@/modules/calendar/service";
import { rangeQuerySchema, type CalendarView as View } from "@/modules/calendar/schemas";
import { addDays, dateKey, isValidTimeZone, parseDateKey, startOfDay, startOfMonthKey, startOfWeek } from "@/modules/calendar/tz";
import { calendarSyncEnabled, listMyConnections } from "@/modules/calendar/connections";
import { calendarProviderStatus } from "@/modules/calendar/providers";
import { CalendarView, type CalEvent, type CalTask } from "@/modules/calendar/components/calendar-view";
import { IntegrationsPanel } from "@/modules/calendar/components/integrations-panel";
import { listAssignableMembers } from "@/modules/org/members";
import { Alert, PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("calendar"))("title") };
}

/** Visible range per view: [start, start + days). Month grids are 6 full weeks. */
function rangeFor(view: View, anchor: string): { start: string; days: number } {
  if (view === "month") return { start: startOfWeek(startOfMonthKey(anchor)), days: 42 };
  if (view === "week") return { start: startOfWeek(anchor), days: 7 };
  if (view === "day") return { start: anchor, days: 1 };
  return { start: anchor, days: 30 };
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const tc0 = await requireTenant();
  const { ctx, user, tenant } = tc0;
  if (!ctx.can("calendar.view")) redirect("/dashboard");
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const parsed = rangeQuerySchema.safeParse(flat);
  const query = parsed.success ? parsed.data : rangeQuerySchema.parse({});
  const tz = isValidTimeZone(tenant.timezone) ? tenant.timezone : "Asia/Jerusalem";
  const today = dateKey(new Date(), tz);
  const anchor = query.date && parseDateKey(query.date) ? query.date : today;
  const mine = query.mine === "1";
  const { start, days } = rangeFor(query.view, anchor);
  const t = await getTranslations("calendar");
  const ti = await getTranslations("calendar.integrations");

  const [range, members, connections, flagEnabled] = await Promise.all([
    listCalendarRange(ctx, startOfDay(start, tz), startOfDay(addDays(start, days), tz), { ownerId: mine ? user.userId : null }),
    listAssignableMembers(ctx),
    listMyConnections(ctx),
    calendarSyncEnabled(tenant.id),
  ]);
  const elevated = tc0.role === "owner" || tc0.role === "manager";
  const canManage = ctx.can("calendar.manage") && !ctx.readOnly;

  const events: CalEvent[] = range.events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    location: e.location,
    start: e.startsAt.toISOString(),
    end: e.endsAt.toISOString(),
    allDay: e.allDay,
    ownerId: e.ownerId,
    ownerName: e.ownerName,
    link: e.contactId
      ? { kind: "contact", option: { id: e.contactId, name: e.contactName ?? "—" } }
      : e.dealId
        ? { kind: "deal", option: { id: e.dealId, name: e.dealTitle ?? "—" } }
        : e.companyId
          ? { kind: "company", option: { id: e.companyId, name: e.companyName ?? "—" } }
          : null,
    external: e.externalProvider,
    canEdit: canManage && (elevated || e.ownerId === user.userId || e.createdBy === user.userId),
  }));
  const tasks: CalTask[] = range.tasks
    .filter((x) => x.dueAt)
    .map((x) => ({ id: x.id, title: x.title, due: x.dueAt!.toISOString(), status: x.status, priority: x.priority, assigneeName: x.assigneeName }));

  const integration = typeof flat.integration === "string" ? flat.integration : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      {integration === "connected" && <Alert tone="success">{ti("success")}</Alert>}
      {integration === "failed" && <Alert tone="danger">{ti("failed")}</Alert>}
      {integration === "unavailable" && <Alert tone="warning">{ti("unavailable")}</Alert>}
      <CalendarView
        key={`${query.view}:${start}`}
        view={query.view}
        anchor={anchor}
        rangeStart={start}
        days={days}
        today={today}
        timezone={tz}
        events={events}
        tasks={tasks}
        members={members.map((m) => ({ userId: m.userId, fullName: m.fullName }))}
        currentUserId={user.userId}
        canManage={canManage}
        canChooseOwner={elevated && canManage}
        mine={mine}
      />
      <IntegrationsPanel providers={calendarProviderStatus()} flagEnabled={flagEnabled} connections={connections} canManage={canManage} />
    </div>
  );
}
