import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { and, eq, isNull } from "drizzle-orm";
import { CheckSquare } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { schema } from "@/server/db";
import { isAppError } from "@/server/errors";
import { getTask, listTasks, taskCounts, type TaskListItem } from "@/modules/tasks/service";
import { TASK_PRIORITIES, TASK_TABS, parseTaskQuery } from "@/modules/tasks/schemas";
import { listAssignableMembers } from "@/modules/org/members";
import { contactDisplayName } from "@/modules/crm/contacts/service";
import { NewTaskButton, TaskList } from "@/modules/tasks/components/task-list";
import { UrlDateInput } from "@/modules/tasks/components/date-filter";
import type { LinkValue } from "@/modules/tasks/components/link-picker";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { FilterSelect, Pagination, SearchInput } from "@/components/data/url-state";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  return { title: (await getTranslations("tasks"))("title") };
}

const UUID = /^[0-9a-f-]{36}$/i;

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const tc0 = await requireTenant();
  const { ctx, user } = tc0;
  const raw = await searchParams;
  const query = parseTaskQuery(raw);
  const one = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const t = await getTranslations("tasks");
  const tc = await getTranslations("common");

  const [{ rows, total, timezone }, counts, members] = await Promise.all([listTasks(ctx, query), taskCounts(ctx), listAssignableMembers(ctx)]);

  // Deep link to a task (`?task=<id>`, e.g. from a reminder notification).
  let openTask: TaskListItem | null = null;
  const taskParam = one("task");
  if (taskParam && UUID.test(taskParam)) {
    openTask = rows.find((r) => r.id === taskParam) ?? (await getTask(ctx, taskParam).catch((e) => (isAppError(e) ? null : Promise.reject(e))));
  }

  // `?new=1&contact=<id>` (and deal/company/lead) prefill the related record.
  let prefill: LinkValue = null;
  for (const kind of ["contact", "deal", "company", "lead"] as const) {
    const id = one(kind);
    if (!id || !UUID.test(id) || prefill) continue;
    const name = await ctx.run(async (tx) => {
      if (kind === "contact") {
        const [c] = await tx.select().from(schema.contacts).where(and(eq(schema.contacts.id, id), eq(schema.contacts.tenantId, ctx.tenantId), isNull(schema.contacts.deletedAt)));
        return c ? contactDisplayName(c) : null;
      }
      if (kind === "deal") {
        const [d] = await tx.select({ n: schema.deals.title }).from(schema.deals).where(and(eq(schema.deals.id, id), eq(schema.deals.tenantId, ctx.tenantId), isNull(schema.deals.deletedAt)));
        return d?.n ?? null;
      }
      if (kind === "company") {
        const [c] = await tx.select({ n: schema.companies.name }).from(schema.companies).where(and(eq(schema.companies.id, id), eq(schema.companies.tenantId, ctx.tenantId), isNull(schema.companies.deletedAt)));
        return c?.n ?? null;
      }
      const [l] = await tx.select({ n: schema.leads.fullName, e: schema.leads.email }).from(schema.leads).where(and(eq(schema.leads.id, id), eq(schema.leads.tenantId, ctx.tenantId), isNull(schema.leads.deletedAt)));
      return l ? l.n || l.e || "—" : null;
    });
    if (name) prefill = { kind, option: { id, name } };
  }

  const common = {
    members: members.map((m) => ({ userId: m.userId, fullName: m.fullName })),
    currentUserId: user.userId,
    canAssignOthers: ctx.can("tasks.assign_others"),
    timezone,
  };
  const canCreate = ctx.can("tasks.create") && !ctx.readOnly;
  const tabCount: Partial<Record<(typeof TASK_TABS)[number], number>> = { mine: counts.mine, overdue: counts.overdue, today: counts.today };
  const baseParams = (tab: string) => {
    const p = new URLSearchParams();
    p.set("tab", tab);
    return `/tasks?${p}`;
  };
  const filtered = Boolean(query.q || query.priority || query.assignee || query.entity || query.from || query.to);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={canCreate && <NewTaskButton common={common} prefill={prefill ? { link: prefill } : undefined} openInitially={one("new") === "1"} />}
      />
      <nav aria-label={t("title")} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {TASK_TABS.map((tab) => {
          const active = query.tab === tab;
          const n = tabCount[tab];
          return (
            <Link
              key={tab}
              href={baseParams(tab)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`tabs.${tab}`)}
              {n ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px] tabular",
                    tab === "overdue" ? "bg-danger-soft text-danger-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {n}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-center">
        <SearchInput placeholder={t("searchPlaceholder")} className="xl:max-w-xs xl:flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect param="priority" label={t("fields.priority")} options={TASK_PRIORITIES.map((p) => ({ value: p, label: t(`priorities.${p}`) }))} />
          {query.tab !== "mine" && (
            <FilterSelect
              param="assignee"
              label={t("fields.assignee")}
              options={[{ value: "me", label: tc("me") }, { value: "unassigned", label: t("unassigned") }, ...common.members.map((m) => ({ value: m.userId, label: m.fullName }))]}
            />
          )}
          <FilterSelect
            param="entity"
            label={t("entityFilter.label")}
            options={(["contact", "company", "deal", "lead", "none"] as const).map((e) => ({ value: e, label: t(`entityFilter.${e}`) }))}
          />
          <UrlDateInput param="from" label={t("dueFrom")} />
          <UrlDateInput param="to" label={t("dueTo")} />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<CheckSquare />}
          title={filtered ? tc("noResults") : query.tab === "done" ? t("emptyDone") : query.tab === "mine" ? t("allClear") : t("emptyTitle")}
          description={filtered ? undefined : t("emptyBody")}
        />
      ) : (
        <>
          <TaskList rows={rows} common={common} canDelete={ctx.can("tasks.delete")} readOnly={ctx.readOnly} openTask={openTask} />
          <Pagination page={query.page} pageSize={query.pageSize} total={total} />
        </>
      )}
      {rows.length === 0 && openTask && <TaskList rows={[]} common={common} canDelete={false} readOnly={ctx.readOnly} openTask={openTask} />}
    </>
  );
}
