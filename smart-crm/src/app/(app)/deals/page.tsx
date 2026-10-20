import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { and, eq, isNull } from "drizzle-orm";
import { Handshake, KanbanSquare, List, Scale, Target, Trophy, Wallet } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { schema } from "@/server/db";
import { getBoard, getForecast, listDeals } from "@/modules/sales/deals";
import { listLostReasons, listPipelines } from "@/modules/sales/pipelines";
import { DEAL_STATUSES, dealListQuerySchema, parseQuery, type DealListQuery } from "@/modules/sales/schemas";
import { DealFormDialog } from "@/modules/sales/components/deal-form-dialog";
import { KanbanBoard } from "@/modules/sales/components/kanban-board";
import { dealStatusTone } from "@/modules/sales/components/badges";
import { listTags } from "@/modules/crm/tags";
import { listAssignableMembers } from "@/modules/org/members";
import { getCustomFieldDefs } from "@/modules/crm/custom-fields";
import { Badge, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterSelect, Pagination, SearchInput } from "@/components/data/url-state";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("deals") };
}

/** Short stable signature so the board resets its local state when server data changes. */
function signature(parts: string[]): string {
  let h = 0;
  for (const p of parts) for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) | 0;
  return String(h);
}

function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function DealsPage({ searchParams }: PageProps<"/deals">) {
  const { ctx, tenant } = await requireTenant();
  const raw = await searchParams;
  const query = parseQuery(dealListQuerySchema, raw);
  const t = await getTranslations("deals");
  const tc = await getTranslations("common");
  const locale = (await getLocale()) as "he" | "en";
  const [pipelines, tags, members, defs, lostReasons] = await Promise.all([
    listPipelines(ctx),
    listTags(ctx),
    listAssignableMembers(ctx),
    getCustomFieldDefs(ctx, "deal"),
    listLostReasons(ctx, { activeOnly: true }),
  ]);
  const pipeline = pipelines.find((p) => p.id === query.pipeline) ?? pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const isBoard = query.view === "board";
  const forecast = pipeline ? await getForecast(ctx, { pipelineId: pipeline.id, currency: tenant.currency }) : null;

  // Prefill from links like /deals?new=1&contact=<id> (contact & company pages, command palette).
  const prefillContactId = typeof raw.contact === "string" && /^[0-9a-f-]{36}$/i.test(raw.contact) ? raw.contact : null;
  const prefillCompanyId = typeof raw.company === "string" && /^[0-9a-f-]{36}$/i.test(raw.company) ? raw.company : null;
  const prefill = await ctx.run(async (tx) => {
    const [contact] = prefillContactId
      ? await tx
          .select({ id: schema.contacts.id, first: schema.contacts.firstName, last: schema.contacts.lastName, companyId: schema.contacts.companyId })
          .from(schema.contacts)
          .where(and(eq(schema.contacts.id, prefillContactId), eq(schema.contacts.tenantId, ctx.tenantId), isNull(schema.contacts.deletedAt)))
      : [];
    const companyId = prefillCompanyId ?? contact?.companyId ?? null;
    const [company] = companyId
      ? await tx
          .select({ id: schema.companies.id, name: schema.companies.name })
          .from(schema.companies)
          .where(and(eq(schema.companies.id, companyId), eq(schema.companies.tenantId, ctx.tenantId), isNull(schema.companies.deletedAt)))
      : [];
    return {
      contact: contact ? { id: contact.id, name: `${contact.first} ${contact.last}`.trim() || "—" } : null,
      company: company ?? null,
      pipelineId: pipeline?.id,
    };
  });

  const pipelineOptions = pipelines.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stages: p.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, probability: s.probability })),
  }));
  const canCreate = ctx.can("deals.create") && !ctx.readOnly;
  const form = canCreate && pipelines.length > 0 && (
    <DealFormDialog
      members={members}
      tags={tags}
      customFieldDefs={defs}
      pipelines={pipelineOptions}
      defaultCurrency={tenant.currency}
      prefill={prefill}
      openFromQuery
    />
  );

  const viewHref = (view: "board" | "list") => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v && !["view", "page", "new", "contact", "company"].includes(k)) p.set(k, v);
    p.set("view", view);
    return `/deals?${p}`;
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={forecast ? t("kpis.count", { count: forecast.openCount }) : undefined}
        actions={
          <>
            <div className="flex rounded-lg border border-border bg-surface p-0.5" role="group" aria-label={`${t("board")} / ${t("list")}`}>
              <Link
                href={viewHref("board")}
                aria-current={isBoard ? "page" : undefined}
                className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm", isBoard ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}
              >
                <KanbanSquare className="size-4" /> {t("board")}
              </Link>
              <Link
                href={viewHref("list")}
                aria-current={!isBoard ? "page" : undefined}
                className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm", !isBoard ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}
              >
                <List className="size-4" /> {t("list")}
              </Link>
            </div>
            {form}
          </>
        }
      />

      {!pipeline ? (
        <EmptyState
          icon={<Handshake />}
          title={t("noPipeline")}
          action={
            ctx.can("pipelines.manage") ? (
              <Button asChild>
                <Link href="/settings/pipelines">{t("toSettings")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {forecast && (
            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="deal-kpis">
              <StatCard label={t("kpis.open")} value={formatMoney(forecast.openValueCents, tenant.currency, locale)} icon={<Wallet />} />
              <StatCard label={t("kpis.weighted")} value={formatMoney(forecast.weightedValueCents, tenant.currency, locale)} icon={<Scale />} />
              <StatCard label={t("kpis.wonThisMonth")} value={formatMoney(forecast.wonThisMonthCents, tenant.currency, locale)} icon={<Trophy />} />
              <StatCard
                label={t("kpis.count", { count: forecast.openCount })}
                value={forecast.openCount}
                icon={<Target />}
                hint={
                  forecast.otherCurrencies.length > 0
                    ? t("otherCurrencies", { list: forecast.otherCurrencies.map((o) => formatMoney(o.openValueCents, o.currency, locale)).join(", ") })
                    : undefined
                }
              />
            </div>
          )}

          <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
            <SearchInput placeholder={t("searchPlaceholder")} className="lg:max-w-sm lg:flex-1" />
            <div className="flex flex-wrap gap-2">
              {pipelines.length > 1 && (
                <FilterSelect
                  param="pipeline"
                  label={t("pipeline")}
                  allLabel={pipelines.find((p) => p.isDefault)?.name}
                  options={pipelines.filter((p) => !p.isDefault).map((p) => ({ value: p.id, label: p.name }))}
                />
              )}
              <FilterSelect
                param="owner"
                label={tc("owner")}
                options={[{ value: "me", label: tc("me") }, { value: "unassigned", label: tc("unassigned") }, ...members.map((m) => ({ value: m.userId, label: m.fullName }))]}
              />
              {!isBoard && <FilterSelect param="status" label={t("status")} options={DEAL_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) }))} />}
              {!isBoard && (
                <FilterSelect
                  param="sort"
                  label={t("sort")}
                  allLabel={t("sorts.created_desc")}
                  options={(["value_desc", "close_asc", "title_asc"] as const).map((s) => ({ value: s, label: t(`sorts.${s}`) }))}
                />
              )}
            </div>
          </div>

          {isBoard ? (
            <BoardView query={query} currency={tenant.currency} timezone={tenant.timezone} canEdit={ctx.can("deals.update") && !ctx.readOnly} lostReasons={lostReasons} />
          ) : (
            <ListView query={query} locale={locale} canCreate={Boolean(form)} createButton={form} />
          )}
        </>
      )}
    </>
  );
}

type DealQuery = DealListQuery;

async function BoardView(props: { query: DealQuery; currency: string; timezone: string; canEdit: boolean; lostReasons: { id: string; label: string }[] }) {
  const { ctx } = await requireTenant();
  const board = await getBoard(ctx, props.query);
  if (!board.pipeline) return null;
  const key = signature(board.deals.map((d) => `${d.id}:${d.stageId}:${d.status}:${d.position}:${d.valueCents}`));
  return (
    <KanbanBoard
      key={`${board.pipeline.id}:${key}`}
      stages={board.pipeline.stages}
      deals={board.deals}
      currency={props.currency}
      canEdit={props.canEdit}
      lostReasons={props.lostReasons}
      today={todayIn(props.timezone)}
    />
  );
}

async function ListView({ query: q, locale, canCreate, createButton }: { query: DealQuery; locale: "he" | "en"; canCreate: boolean; createButton: React.ReactNode }) {
  const { ctx } = await requireTenant();
  const t = await getTranslations("deals");
  const tc = await getTranslations("common");
  const { rows, total } = await listDeals(ctx, q);
  const filtered = Boolean(q.q || q.owner || q.status || q.from || q.to);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Handshake />}
        title={filtered ? tc("noResults") : t("emptyTitle")}
        description={filtered ? undefined : t("emptyBody")}
        action={!filtered && canCreate ? createButton : undefined}
      />
    );
  }
  return (
    <>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>{t("dealTitle")}</TH>
            <TH>{t("stage")}</TH>
            <TH>{t("value")}</TH>
            <TH className="hidden md:table-cell">{t("status")}</TH>
            <TH className="hidden lg:table-cell">{t("expectedClose")}</TH>
            <TH className="hidden md:table-cell">{t("company")}</TH>
            <TH className="hidden lg:table-cell">{tc("owner")}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((d) => (
            <TR key={d.id} className="relative">
              <TD>
                <Link href={`/deals/${d.id}`} className="font-medium after:absolute after:inset-0" data-testid="deal-row" dir="auto">
                  {d.title}
                </Link>
                {d.contactName && <span className="block text-xs text-muted-foreground">{d.contactName}</span>}
              </TD>
              <TD>
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <span className="size-2 rounded-full" style={{ backgroundColor: d.stageColor }} aria-hidden />
                  {d.stageName}
                </span>
              </TD>
              <TD className="tabular font-medium">{formatMoney(d.valueCents, d.currency, locale)}</TD>
              <TD className="hidden md:table-cell">
                <Badge tone={dealStatusTone(d.status)}>{t(`statuses.${d.status}`)}</Badge>
              </TD>
              <TD className="hidden text-muted-foreground lg:table-cell">{d.expectedCloseDate ? formatDate(d.expectedCloseDate, locale) : "—"}</TD>
              <TD className="hidden text-muted-foreground md:table-cell">{d.companyName ?? "—"}</TD>
              <TD className="hidden text-muted-foreground lg:table-cell">{d.ownerName ?? tc("unassigned")}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Pagination page={q.page} pageSize={q.pageSize} total={total} />
    </>
  );
}
