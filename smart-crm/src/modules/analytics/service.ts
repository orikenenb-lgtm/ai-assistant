import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/server/db";
import { assertCan, type ServiceCtx } from "@/server/context";
import { AppError } from "@/server/errors";
import { percentChange, ratio, topNWithOther, winRate } from "./math";
import {
  RANGE_PRESETS,
  addMonths,
  bucketKeys,
  fillBuckets,
  localDate,
  previousRange,
  resolveRange,
  startOfLocalDay,
  toDateString,
  type Bucket,
  type DateRange,
} from "./range";

/* ----------------------------------------------------------------- filters */

export const REPORTS = ["revenue", "pipeline", "leads", "team", "customers"] as const;
export type ReportKey = (typeof REPORTS)[number];

export const filtersSchema = z.object({
  preset: z.enum(RANGE_PRESETS).default("30d"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  owner: z.uuid().optional(),
  pipeline: z.uuid().optional(),
  interval: z.enum(["auto", "day", "week", "month"]).default("auto"),
});
export type AnalyticsFilters = z.infer<typeof filtersSchema>;

/** Lenient parsing of URL params: invalid values fall back to defaults. */
export function parseFilters(params: Record<string, string | string[] | undefined>): AnalyticsFilters {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) flat[k] = value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(filtersSchema.shape) as (keyof typeof filtersSchema.shape)[]) {
    if (flat[key] !== undefined && filtersSchema.shape[key].safeParse(flat[key]).success) out[key] = flat[key];
  }
  return filtersSchema.parse(out);
}

export type Scope = {
  tenantId: string;
  timeZone: string;
  currency: string;
  /** Owner the data is restricted to (forced to self for agents). */
  ownerId: string | null;
  agentScoped: boolean;
  pipelineId: string | null;
  range: DateRange;
};


async function rows<T>(tx: Tx, query: SQL): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

/**
 * Resolves the effective scope for a request. Agents only ever see their own
 * records — the owner filter is forced server-side, whatever the URL says.
 */
export async function resolveScope(ctx: ServiceCtx, filters: AnalyticsFilters, opts: { now?: Date } = {}): Promise<Scope> {
  const agentScoped = ctx.role === "agent";
  return ctx.run(async (tx) => {
    const [tenant] = await rows<{ timezone: string; currency: string }>(
      tx,
      sql`select timezone, currency from public.tenants where id = ${ctx.tenantId}`,
    );
    if (!tenant) throw new AppError("NOT_FOUND", "errors.notFound");
    let timeZone = tenant.timezone || "Asia/Jerusalem";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
      timeZone = "Asia/Jerusalem";
    }
    let pipelineId: string | null = null;
    if (filters.pipeline) {
      const [p] = await rows<{ id: string }>(
        tx,
        sql`select id from public.pipelines where id = ${filters.pipeline} and tenant_id = ${ctx.tenantId}`,
      );
      pipelineId = p?.id ?? null;
    }
    return {
      tenantId: ctx.tenantId,
      timeZone,
      currency: tenant.currency,
      ownerId: agentScoped ? ctx.userId : (filters.owner ?? null),
      agentScoped,
      pipelineId,
      range: resolveRange(filters.preset, { from: filters.from, to: filters.to, timeZone, now: opts.now, bucket: filters.interval }),
    };
  });
}

/* ------------------------------------------------------------- sql helpers */

const BUCKET_UNIT: Record<Bucket, string> = { day: "day", week: "week", month: "month" };

/** Local bucket start (YYYY-MM-DD) of a timestamptz column in the tenant zone. Weeks start Sunday. */
function bucketExpr(col: SQL, scope: Pick<Scope, "timeZone">, bucket: Bucket): SQL {
  const local = sql`(${col} at time zone ${scope.timeZone})`;
  if (bucket === "week") return sql`to_char(date_trunc('week', ${local} + interval '1 day') - interval '1 day', 'YYYY-MM-DD')`;
  return sql`to_char(date_trunc(${sql.raw(`'${BUCKET_UNIT[bucket]}'`)}, ${local}), 'YYYY-MM-DD')`;
}

const inRange = (col: SQL, r: Pick<DateRange, "from" | "to">) => sql`${col} >= ${r.from.toISOString()}::timestamptz and ${col} < ${r.to.toISOString()}::timestamptz`;
const ownerIs = (col: SQL, scope: Scope) => (scope.ownerId ? sql` and ${col} = ${scope.ownerId}` : sql``);
const pipelineIs = (col: SQL, scope: Scope) => (scope.pipelineId ? sql` and ${col} = ${scope.pipelineId}` : sql``);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/* ----------------------------------------------------------------- revenue */

export type RevenueReport = {
  currency: string;
  bucket: Bucket;
  totals: {
    wonCount: number;
    wonValueCents: number;
    lostCount: number;
    avgDealCents: number | null;
    winRate: number | null;
    previousWonValueCents: number;
    changePct: number | null;
  };
  series: { bucket: string; wonCount: number; wonValueCents: number }[];
  lostReasons: { label: string | null; count: number }[];
  excludedOtherCurrency: number;
};

async function wonTotals(tx: Tx, scope: Scope, range: Pick<DateRange, "from" | "to">) {
  const [r] = await rows<{ n: number; v: number }>(
    tx,
    sql`select count(*)::int as n, coalesce(sum(value_cents), 0)::float8 as v from public.deals d
        where d.tenant_id = ${scope.tenantId} and d.status = 'won' and d.deleted_at is null and d.currency = ${scope.currency}
          and ${inRange(sql`d.won_at`, range)}${ownerIs(sql`d.owner_id`, scope)}${pipelineIs(sql`d.pipeline_id`, scope)}`,
  );
  return { count: num(r?.n), value: Math.round(num(r?.v)) };
}

export async function revenueReport(ctx: ServiceCtx, scope: Scope): Promise<RevenueReport> {
  assertCan(ctx, "analytics.view");
  return ctx.run(async (tx) => {
    const r = scope.range;
    const won = await wonTotals(tx, scope, r);
    const prev = await wonTotals(tx, scope, previousRange(r, scope.timeZone));
    const [lost] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from public.deals d
          where d.tenant_id = ${scope.tenantId} and d.status = 'lost' and d.deleted_at is null
            and ${inRange(sql`d.lost_at`, r)}${ownerIs(sql`d.owner_id`, scope)}${pipelineIs(sql`d.pipeline_id`, scope)}`,
    );
    const series = await rows<{ bucket: string; n: number; v: number }>(
      tx,
      sql`select ${bucketExpr(sql`d.won_at`, scope, r.bucket)} as bucket, count(*)::int as n, coalesce(sum(d.value_cents), 0)::float8 as v
          from public.deals d
          where d.tenant_id = ${scope.tenantId} and d.status = 'won' and d.deleted_at is null and d.currency = ${scope.currency}
            and ${inRange(sql`d.won_at`, r)}${ownerIs(sql`d.owner_id`, scope)}${pipelineIs(sql`d.pipeline_id`, scope)}
          group by 1`,
    );
    const lostReasons = await rows<{ label: string | null; n: number }>(
      tx,
      sql`select lr.label, count(*)::int as n from public.deals d
          left join public.lost_reasons lr on lr.id = d.lost_reason_id
          where d.tenant_id = ${scope.tenantId} and d.status = 'lost' and d.deleted_at is null
            and ${inRange(sql`d.lost_at`, r)}${ownerIs(sql`d.owner_id`, scope)}${pipelineIs(sql`d.pipeline_id`, scope)}
          group by lr.label order by n desc, lr.label nulls last`,
    );
    const [other] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from public.deals d
          where d.tenant_id = ${scope.tenantId} and d.status = 'won' and d.deleted_at is null and d.currency <> ${scope.currency}
            and ${inRange(sql`d.won_at`, r)}${ownerIs(sql`d.owner_id`, scope)}${pipelineIs(sql`d.pipeline_id`, scope)}`,
    );
    const keys = bucketKeys(r);
    return {
      currency: scope.currency,
      bucket: r.bucket,
      totals: {
        wonCount: won.count,
        wonValueCents: won.value,
        lostCount: num(lost?.n),
        avgDealCents: won.count ? Math.round(won.value / won.count) : null,
        winRate: winRate(won.count, num(lost?.n)),
        previousWonValueCents: prev.value,
        changePct: percentChange(won.value, prev.value),
      },
      series: fillBuckets(
        keys,
        series.map((s) => ({ bucket: s.bucket, wonCount: num(s.n), wonValueCents: Math.round(num(s.v)) })),
        (bucket) => ({ bucket, wonCount: 0, wonValueCents: 0 }),
      ),
      lostReasons: lostReasons.map((l) => ({ label: l.label, count: num(l.n) })),
      excludedOtherCurrency: num(other?.n),
    };
  });
}

/* ---------------------------------------------------------------- pipeline */

export type PipelineStageRow = {
  stageId: string;
  name: string;
  color: string;
  kind: "open" | "won" | "lost";
  probability: number;
  openCount: number;
  openValueCents: number;
  weightedValueCents: number;
  reachedCount: number;
  avgDaysInStage: number | null;
};

export type PipelineReport = {
  currency: string;
  pipelines: { id: string; name: string; isDefault: boolean }[];
  pipelineId: string | null;
  stages: PipelineStageRow[];
  totals: { openCount: number; openValueCents: number; weightedValueCents: number; createdInRange: number };
  forecast: { month: string; valueCents: number; weightedValueCents: number; count: number }[];
  overdue: { count: number; valueCents: number };
  noCloseDate: { count: number; valueCents: number };
};

async function listPipelines(tx: Tx, tenantId: string) {
  return rows<{ id: string; name: string; is_default: boolean }>(
    tx,
    sql`select id, name, is_default from public.pipelines where tenant_id = ${tenantId} and archived_at is null order by is_default desc, position, name`,
  );
}

/** Open pipeline value by stage (current snapshot, not range-bound). */
async function stageSnapshot(tx: Tx, scope: Scope, pipelineId: string) {
  return rows<{ id: string; name: string; color: string; kind: PipelineStageRow["kind"]; probability: number; position: number; n: number; v: number; w: number }>(
    tx,
    sql`select s.id, s.name, s.color, s.kind, s.probability, s.position,
               count(d.id)::int as n,
               coalesce(sum(d.value_cents), 0)::float8 as v,
               coalesce(sum(round(d.value_cents * coalesce(d.probability, s.probability) / 100.0)), 0)::float8 as w
        from public.pipeline_stages s
        left join public.deals d
          on d.stage_id = s.id and d.tenant_id = ${scope.tenantId} and d.status = 'open' and d.deleted_at is null
         and d.currency = ${scope.currency}${ownerIs(sql`d.owner_id`, scope)}
        where s.tenant_id = ${scope.tenantId} and s.pipeline_id = ${pipelineId}
        group by s.id order by s.position, s.name`,
  );
}

export async function pipelineReport(ctx: ServiceCtx, scope: Scope): Promise<PipelineReport> {
  assertCan(ctx, "analytics.view");
  return ctx.run(async (tx) => {
    const pipelines = await listPipelines(tx, scope.tenantId);
    const pipelineId = scope.pipelineId ?? pipelines[0]?.id ?? null;
    const base = {
      currency: scope.currency,
      pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, isDefault: p.is_default })),
      pipelineId,
    };
    if (!pipelineId) {
      return {
        ...base,
        stages: [],
        totals: { openCount: 0, openValueCents: 0, weightedValueCents: 0, createdInRange: 0 },
        forecast: [],
        overdue: { count: 0, valueCents: 0 },
        noCloseDate: { count: 0, valueCents: 0 },
      };
    }
    const r = scope.range;
    const snapshot = await stageSnapshot(tx, scope, pipelineId);
    // Funnel: deals created in range, counted at every stage up to the furthest one they reached.
    const reached = await rows<{ stage_id: string; n: number }>(
      tx,
      sql`with reached as (
            select h.deal_id, max(s.position) as max_pos
            from public.deal_stage_history h
            join public.deals d on d.id = h.deal_id and d.tenant_id = ${scope.tenantId} and d.deleted_at is null
             and d.pipeline_id = ${pipelineId} and ${inRange(sql`d.created_at`, r)}${ownerIs(sql`d.owner_id`, scope)}
            join public.pipeline_stages s on s.id = h.to_stage_id and s.kind <> 'lost'
            where h.tenant_id = ${scope.tenantId}
            group by h.deal_id)
          select st.id as stage_id, count(r.deal_id)::int as n
          from public.pipeline_stages st
          left join reached r on r.max_pos >= st.position
          where st.tenant_id = ${scope.tenantId} and st.pipeline_id = ${pipelineId} and st.kind <> 'lost'
          group by st.id`,
    );
    const [created] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from public.deals d where d.tenant_id = ${scope.tenantId} and d.deleted_at is null
          and d.pipeline_id = ${pipelineId} and ${inRange(sql`d.created_at`, r)}${ownerIs(sql`d.owner_id`, scope)}`,
    );
    // Time in stage: entries during the range; open entries are measured until now.
    const durations = await rows<{ stage_id: string; avg_days: number }>(
      tx,
      sql`with moves as (
            select h.deal_id, h.to_stage_id, h.changed_at,
                   lead(h.changed_at) over (partition by h.deal_id order by h.changed_at, h.id) as left_at
            from public.deal_stage_history h
            join public.deals d on d.id = h.deal_id and d.tenant_id = ${scope.tenantId} and d.deleted_at is null
             and d.pipeline_id = ${pipelineId}${ownerIs(sql`d.owner_id`, scope)}
            where h.tenant_id = ${scope.tenantId} and h.from_stage_id is distinct from h.to_stage_id)
          select m.to_stage_id as stage_id,
                 avg(extract(epoch from (coalesce(m.left_at, now()) - m.changed_at)))::float8 / 86400 as avg_days
          from moves m
          join public.pipeline_stages s on s.id = m.to_stage_id and s.kind = 'open'
          where ${inRange(sql`m.changed_at`, r)}
          group by m.to_stage_id`,
    );
    // Forecast: open deals by expected close month (this month + 5), weighted.
    const today = localDate(new Date(), scope.timeZone);
    const monthStart = `${today.slice(0, 7)}-01`;
    const horizonEnd = addMonths(monthStart, 6);
    const forecast = await rows<{ month: string; n: number; v: number; w: number }>(
      tx,
      sql`select to_char(date_trunc('month', d.expected_close_date), 'YYYY-MM-DD') as month, count(*)::int as n,
                 coalesce(sum(d.value_cents), 0)::float8 as v,
                 coalesce(sum(round(d.value_cents * coalesce(d.probability, s.probability) / 100.0)), 0)::float8 as w
          from public.deals d join public.pipeline_stages s on s.id = d.stage_id
          where d.tenant_id = ${scope.tenantId} and d.status = 'open' and d.deleted_at is null and d.currency = ${scope.currency}
            and d.pipeline_id = ${pipelineId}${ownerIs(sql`d.owner_id`, scope)}
            and d.expected_close_date >= ${monthStart}::date and d.expected_close_date < ${horizonEnd}::date
          group by 1`,
    );
    const [edges] = await rows<{ overdue_n: number; overdue_v: number; none_n: number; none_v: number }>(
      tx,
      sql`select count(*) filter (where d.expected_close_date < ${monthStart}::date)::int as overdue_n,
                 coalesce(sum(d.value_cents) filter (where d.expected_close_date < ${monthStart}::date), 0)::float8 as overdue_v,
                 count(*) filter (where d.expected_close_date is null)::int as none_n,
                 coalesce(sum(d.value_cents) filter (where d.expected_close_date is null), 0)::float8 as none_v
          from public.deals d
          where d.tenant_id = ${scope.tenantId} and d.status = 'open' and d.deleted_at is null and d.currency = ${scope.currency}
            and d.pipeline_id = ${pipelineId}${ownerIs(sql`d.owner_id`, scope)}`,
    );
    const reachedBy = new Map(reached.map((x) => [x.stage_id, num(x.n)]));
    const daysBy = new Map(durations.map((x) => [x.stage_id, num(x.avg_days)]));
    const stages: PipelineStageRow[] = snapshot.map((s) => ({
      stageId: s.id,
      name: s.name,
      color: s.color,
      kind: s.kind,
      probability: s.probability,
      openCount: num(s.n),
      openValueCents: Math.round(num(s.v)),
      weightedValueCents: Math.round(num(s.w)),
      reachedCount: reachedBy.get(s.id) ?? 0,
      avgDaysInStage: daysBy.has(s.id) ? Math.round(daysBy.get(s.id)! * 10) / 10 : null,
    }));
    const months = Array.from({ length: 6 }, (_, i) => addMonths(monthStart, i));
    const fBy = new Map(forecast.map((f) => [f.month, f]));
    return {
      ...base,
      stages,
      totals: {
        openCount: stages.reduce((a, s) => a + s.openCount, 0),
        openValueCents: stages.reduce((a, s) => a + s.openValueCents, 0),
        weightedValueCents: stages.reduce((a, s) => a + s.weightedValueCents, 0),
        createdInRange: num(created?.n),
      },
      forecast: months.map((m) => {
        const f = fBy.get(m);
        return { month: m, count: num(f?.n), valueCents: Math.round(num(f?.v)), weightedValueCents: Math.round(num(f?.w)) };
      }),
      overdue: { count: num(edges?.overdue_n), valueCents: Math.round(num(edges?.overdue_v)) },
      noCloseDate: { count: num(edges?.none_n), valueCents: Math.round(num(edges?.none_v)) },
    };
  });
}

/* ------------------------------------------------------------------- leads */

export type LeadsReport = {
  bucket: Bucket;
  totals: { created: number; converted: number; conversionRate: number | null; medianSecondsToConvert: number | null; previousCreated: number; changePct: number | null };
  sources: string[];
  series: ({ bucket: string } & Record<string, number | string>)[];
  bySource: { source: string; count: number }[];
  byStatus: { status: string; count: number }[];
  classification: { label: string; count: number }[];
};

const MAX_SOURCE_SERIES = 5;

export async function leadsReport(ctx: ServiceCtx, scope: Scope): Promise<LeadsReport> {
  assertCan(ctx, "analytics.view");
  return ctx.run(async (tx) => {
    const r = scope.range;
    const base = sql`l.tenant_id = ${scope.tenantId} and l.deleted_at is null${ownerIs(sql`l.owner_id`, scope)}`;
    const perBucket = await rows<{ bucket: string; source: string; n: number }>(
      tx,
      sql`select ${bucketExpr(sql`l.created_at`, scope, r.bucket)} as bucket, l.source, count(*)::int as n
          from public.leads l where ${base} and ${inRange(sql`l.created_at`, r)} group by 1, 2`,
    );
    const [conv] = await rows<{ created: number; converted: number }>(
      tx,
      sql`select count(*)::int as created, count(*) filter (where l.status = 'converted')::int as converted
          from public.leads l where ${base} and ${inRange(sql`l.created_at`, r)}`,
    );
    const [prev] = await rows<{ n: number }>(
      tx,
      sql`select count(*)::int as n from public.leads l where ${base} and ${inRange(sql`l.created_at`, previousRange(r, scope.timeZone))}`,
    );
    const [time] = await rows<{ median: number | null }>(
      tx,
      sql`select percentile_cont(0.5) within group (order by extract(epoch from (l.converted_at - l.created_at)))::float8 as median
          from public.leads l where ${base} and l.converted_at is not null and ${inRange(sql`l.converted_at`, r)}`,
    );
    const statuses = await rows<{ status: string; n: number }>(
      tx,
      sql`select l.status, count(*)::int as n from public.leads l where ${base} and ${inRange(sql`l.created_at`, r)} group by 1 order by n desc`,
    );
    const classes = await rows<{ label: string; n: number }>(
      tx,
      sql`select coalesce(l.ai_classification, 'unclassified') as label, count(*)::int as n
          from public.leads l where ${base} and ${inRange(sql`l.created_at`, r)} group by 1 order by n desc`,
    );
    const totalsBySource = new Map<string, number>();
    for (const row of perBucket) totalsBySource.set(row.source, (totalsBySource.get(row.source) ?? 0) + num(row.n));
    const top = topNWithOther(
      [...totalsBySource].map(([key, value]) => ({ key, value })),
      MAX_SOURCE_SERIES,
      "other_sources",
    );
    const kept = new Set(top.map((t) => t.key));
    const sources = top.map((t) => t.key);
    const byBucket = new Map<string, Record<string, number>>();
    for (const row of perBucket) {
      const key = kept.has(row.source) ? row.source : "other_sources";
      const entry = byBucket.get(row.bucket) ?? {};
      entry[key] = (entry[key] ?? 0) + num(row.n);
      byBucket.set(row.bucket, entry);
    }
    const created = num(conv?.created);
    const converted = num(conv?.converted);
    return {
      bucket: r.bucket,
      totals: {
        created,
        converted,
        conversionRate: ratio(converted, created),
        medianSecondsToConvert: time?.median === null || time?.median === undefined ? null : Math.round(num(time.median)),
        previousCreated: num(prev?.n),
        changePct: percentChange(created, num(prev?.n)),
      },
      sources,
      series: bucketKeys(r).map((bucket) => {
        const values = byBucket.get(bucket) ?? {};
        return { bucket, ...Object.fromEntries(sources.map((s) => [s, values[s] ?? 0])) };
      }),
      bySource: top.map((t) => ({ source: t.key, count: t.value })),
      byStatus: statuses.map((s) => ({ status: s.status, count: num(s.n) })),
      classification: classes.map((c) => ({ label: c.label, count: num(c.n) })),
    };
  });
}

/* -------------------------------------------------------------------- team */

export type TeamMemberRow = {
  userId: string;
  name: string;
  wonCount: number;
  wonValueCents: number;
  lostCount: number;
  winRate: number | null;
  activities: { call: number; meeting: number; email: number; note: number };
  tasksCompleted: number;
  conversationsHandled: number;
  medianFirstResponseSeconds: number | null;
  responses: number;
};

export type TeamReport = { currency: string; members: TeamMemberRow[] };

export async function teamReport(ctx: ServiceCtx, scope: Scope): Promise<TeamReport> {
  assertCan(ctx, "analytics.view");
  return ctx.run(async (tx) => {
    const r = scope.range;
    const t = scope.tenantId;
    const userFilter = (col: SQL) => (scope.ownerId ? sql` and ${col} = ${scope.ownerId}` : sql``);
    const members = await rows<{ user_id: string; name: string }>(
      tx,
      sql`select m.user_id, coalesce(nullif(p.full_name, ''), p.email) as name
          from public.memberships m join public.profiles p on p.id = m.user_id
          where m.tenant_id = ${t}${userFilter(sql`m.user_id`)} order by name`,
    );
    const deals = await rows<{ owner_id: string; won_n: number; won_v: number; lost_n: number }>(
      tx,
      sql`select d.owner_id,
                 count(*) filter (where d.status = 'won' and ${inRange(sql`d.won_at`, r)})::int as won_n,
                 coalesce(sum(d.value_cents) filter (where d.status = 'won' and d.currency = ${scope.currency} and ${inRange(sql`d.won_at`, r)}), 0)::float8 as won_v,
                 count(*) filter (where d.status = 'lost' and ${inRange(sql`d.lost_at`, r)})::int as lost_n
          from public.deals d
          where d.tenant_id = ${t} and d.deleted_at is null and d.owner_id is not null${userFilter(sql`d.owner_id`)}${pipelineIs(sql`d.pipeline_id`, scope)}
          group by d.owner_id`,
    );
    const acts = await rows<{ actor_id: string; type: string; n: number }>(
      tx,
      sql`select a.actor_id, a.type, count(*)::int as n from public.activities a
          where a.tenant_id = ${t} and a.actor_id is not null and a.type in ('call', 'meeting', 'email', 'note')
            and ${inRange(sql`a.occurred_at`, r)}${userFilter(sql`a.actor_id`)}
          group by 1, 2`,
    );
    const tasks = await rows<{ user_id: string; n: number }>(
      tx,
      sql`select t.completed_by as user_id, count(*)::int as n from public.tasks t
          where t.tenant_id = ${t} and t.status = 'done' and t.completed_by is not null
            and ${inRange(sql`t.completed_at`, r)}${userFilter(sql`t.completed_by`)}
          group by 1`,
    );
    const convs = await rows<{ user_id: string; n: number }>(
      tx,
      sql`select m.sender_user_id as user_id, count(distinct m.conversation_id)::int as n from public.messages m
          where m.tenant_id = ${t} and m.direction = 'outbound' and m.sender_type = 'user' and m.sender_user_id is not null
            and ${inRange(sql`m.created_at`, r)}${userFilter(sql`m.sender_user_id`)}
          group by 1`,
    );
    const response = await firstResponseByUser(tx, scope);
    const dealsBy = new Map(deals.map((d) => [d.owner_id, d]));
    const tasksBy = new Map(tasks.map((x) => [x.user_id, num(x.n)]));
    const convBy = new Map(convs.map((x) => [x.user_id, num(x.n)]));
    const respBy = new Map(response.map((x) => [x.userId, x]));
    return {
      currency: scope.currency,
      members: members.map((m) => {
        const d = dealsBy.get(m.user_id);
        const a = { call: 0, meeting: 0, email: 0, note: 0 };
        for (const row of acts) if (row.actor_id === m.user_id) a[row.type as keyof typeof a] = num(row.n);
        const wonN = num(d?.won_n);
        const lostN = num(d?.lost_n);
        const resp = respBy.get(m.user_id);
        return {
          userId: m.user_id,
          name: m.name,
          wonCount: wonN,
          wonValueCents: Math.round(num(d?.won_v)),
          lostCount: lostN,
          winRate: winRate(wonN, lostN),
          activities: a,
          tasksCompleted: tasksBy.get(m.user_id) ?? 0,
          conversationsHandled: convBy.get(m.user_id) ?? 0,
          medianFirstResponseSeconds: resp?.medianSeconds ?? null,
          responses: resp?.count ?? 0,
        };
      }),
    };
  });
}

/**
 * First-response time: for every customer "turn" (an inbound message that
 * follows an outbound one, or opens the thread) inside the range, the delay
 * until the next outbound message written by a person — attributed to that
 * person. Reported as the median per user.
 */
export async function firstResponseByUser(tx: Tx, scope: Scope): Promise<{ userId: string; medianSeconds: number; count: number }[]> {
  const r = scope.range;
  const lookback = new Date(r.from.getTime() - 7 * 86_400_000).toISOString();
  const result = await rows<{ user_id: string; median: number; n: number }>(
    tx,
    sql`with ordered as (
          select m.id, m.conversation_id, m.direction, m.created_at,
                 lag(m.direction) over (partition by m.conversation_id order by m.created_at, m.id) as prev_dir
          from public.messages m
          where m.tenant_id = ${scope.tenantId} and m.created_at >= ${lookback}::timestamptz and m.created_at < ${r.to.toISOString()}::timestamptz),
        turns as (
          select * from ordered
          where direction = 'inbound' and (prev_dir is null or prev_dir <> 'inbound') and ${inRange(sql`created_at`, r)}),
        responses as (
          select o.sender_user_id as user_id, extract(epoch from (o.created_at - t.created_at)) as seconds
          from turns t
          cross join lateral (
            select x.sender_user_id, x.created_at from public.messages x
            where x.tenant_id = ${scope.tenantId} and x.conversation_id = t.conversation_id
              and x.direction = 'outbound' and x.created_at > t.created_at
            order by x.created_at, x.id limit 1) o
          where o.sender_user_id is not null)
        select user_id, percentile_cont(0.5) within group (order by seconds)::float8 as median, count(*)::int as n
        from responses ${scope.ownerId ? sql`where user_id = ${scope.ownerId}` : sql``}
        group by user_id`,
  );
  return result.map((x) => ({ userId: x.user_id, medianSeconds: Math.round(num(x.median)), count: num(x.n) }));
}

/* --------------------------------------------------------------- customers */

export type CustomersReport = {
  bucket: Bucket;
  totals: { total: number; created: number; previousCreated: number; changePct: number | null; active: number };
  series: { bucket: string; created: number }[];
  lifecycle: { stage: string; count: number }[];
};

export async function customersReport(ctx: ServiceCtx, scope: Scope): Promise<CustomersReport> {
  assertCan(ctx, "analytics.view");
  return ctx.run(async (tx) => {
    const r = scope.range;
    const base = sql`c.tenant_id = ${scope.tenantId} and c.deleted_at is null${ownerIs(sql`c.owner_id`, scope)}`;
    const series = await rows<{ bucket: string; n: number }>(
      tx,
      sql`select ${bucketExpr(sql`c.created_at`, scope, r.bucket)} as bucket, count(*)::int as n
          from public.contacts c where ${base} and ${inRange(sql`c.created_at`, r)} group by 1`,
    );
    const [totals] = await rows<{ total: number; created: number; prev: number }>(
      tx,
      sql`select count(*)::int as total,
                 count(*) filter (where ${inRange(sql`c.created_at`, r)})::int as created,
                 count(*) filter (where ${inRange(sql`c.created_at`, previousRange(r, scope.timeZone))})::int as prev
          from public.contacts c where ${base}`,
    );
    const [active] = await rows<{ n: number }>(
      tx,
      sql`select count(distinct a.contact_id)::int as n from public.activities a
          join public.contacts c on c.id = a.contact_id and ${base}
          where a.tenant_id = ${scope.tenantId} and ${inRange(sql`a.occurred_at`, r)}`,
    );
    const lifecycle = await rows<{ stage: string; n: number }>(
      tx,
      sql`select c.lifecycle_stage as stage, count(*)::int as n from public.contacts c where ${base} group by 1 order by n desc`,
    );
    const created = num(totals?.created);
    return {
      bucket: r.bucket,
      totals: { total: num(totals?.total), created, previousCreated: num(totals?.prev), changePct: percentChange(created, num(totals?.prev)), active: num(active?.n) },
      series: fillBuckets(
        bucketKeys(r),
        series.map((s) => ({ bucket: s.bucket, created: num(s.n) })),
        (bucket) => ({ bucket, created: 0 }),
      ),
      lifecycle: lifecycle.map((l) => ({ stage: l.stage, count: num(l.n) })),
    };
  });
}

/* ---------------------------------------------------------------- dashboard */

export type DashboardData = {
  currency: string;
  timeZone: string;
  agentScoped: boolean;
  hasData: { contacts: number; deals: number; leads: number };
  kpis: {
    openPipelineCents: number;
    openDeals: number;
    weightedPipelineCents: number;
    wonThisMonthCents: number;
    wonLastMonthCents: number;
    wonChangePct: number | null;
    newLeadsThisWeek: number;
    conversionRate90d: number | null;
    leads90d: number;
    openConversations: number;
    unreadMessages: number;
    tasksDueToday: number;
    tasksOverdue: number;
  };
  wonByMonth: { bucket: string; wonValueCents: number; wonCount: number }[];
  pipeline: { pipelineName: string | null; stages: { name: string; color: string; valueCents: number; count: number }[] };
  myTasksToday: { id: string; title: string; dueAt: Date | null; priority: string; overdue: boolean; contactId: string | null; contactName: string | null }[];
  closingSoon: { id: string; title: string; valueCents: number; currency: string; expectedCloseDate: string; probability: number; stageName: string }[];
  recentActivity: {
    id: string;
    type: string;
    subject: string | null;
    occurredAt: Date;
    actorName: string | null;
    actorType: string;
    contactId: string | null;
    contactName: string | null;
    dealId: string | null;
    dealTitle: string | null;
    companyId: string | null;
    companyName: string | null;
    leadId: string | null;
  }[];
};

/**
 * Everything the dashboard shows, in a handful of aggregate queries. Agents
 * see their own numbers; owners/managers see the team.
 */
export async function dashboardData(ctx: ServiceCtx, opts: { now?: Date } = {}): Promise<DashboardData> {
  const scope = await resolveScope(ctx, { preset: "30d", interval: "auto" }, opts);
  const now = opts.now ?? new Date();
  const tz = scope.timeZone;
  const t = scope.tenantId;
  const me = ctx.userId;
  const today = localDate(now, tz);
  const startToday = startOfLocalDay(today, tz);
  const startTomorrow = startOfLocalDay(addDaysLocal(today, 1), tz);
  const monthStartDate = `${today.slice(0, 7)}-01`;
  const monthStart = startOfLocalDay(monthStartDate, tz);
  const lastMonthStart = startOfLocalDay(addMonths(monthStartDate, -1), tz);
  const yearAgoMonth = addMonths(monthStartDate, -11);
  const weekStart = startOfLocalDay(addDaysLocal(today, -new Date(`${today}T00:00:00Z`).getUTCDay()), tz);
  const ninetyAgo = startOfLocalDay(addDaysLocal(today, -89), tz);
  const can = (p: Parameters<ServiceCtx["can"]>[0]) => ctx.can(p);

  return ctx.run(async (tx) => {
    const [counts] = await rows<{ contacts: number; deals: number; leads: number }>(
      tx,
      sql`select (select count(*)::int from public.contacts where tenant_id = ${t} and deleted_at is null) as contacts,
                 (select count(*)::int from public.deals where tenant_id = ${t} and deleted_at is null) as deals,
                 (select count(*)::int from public.leads where tenant_id = ${t} and deleted_at is null) as leads`,
    );
    const [deal] = can("deals.view")
      ? await rows<{ open_n: number; open_v: number; open_w: number; won_m: number; won_lm: number }>(
          tx,
          sql`select count(*) filter (where d.status = 'open')::int as open_n,
                     coalesce(sum(d.value_cents) filter (where d.status = 'open'), 0)::float8 as open_v,
                     coalesce(sum(round(d.value_cents * coalesce(d.probability, s.probability) / 100.0)) filter (where d.status = 'open'), 0)::float8 as open_w,
                     coalesce(sum(d.value_cents) filter (where d.status = 'won' and d.won_at >= ${monthStart.toISOString()}::timestamptz), 0)::float8 as won_m,
                     coalesce(sum(d.value_cents) filter (where d.status = 'won' and d.won_at >= ${lastMonthStart.toISOString()}::timestamptz
                                                         and d.won_at < ${monthStart.toISOString()}::timestamptz), 0)::float8 as won_lm
              from public.deals d join public.pipeline_stages s on s.id = d.stage_id
              where d.tenant_id = ${t} and d.deleted_at is null and d.currency = ${scope.currency}${ownerIs(sql`d.owner_id`, scope)}`,
        )
      : [];
    const [lead] = can("leads.view")
      ? await rows<{ week: number; n90: number; c90: number }>(
          tx,
          sql`select count(*) filter (where l.created_at >= ${weekStart.toISOString()}::timestamptz)::int as week,
                     count(*) filter (where l.created_at >= ${ninetyAgo.toISOString()}::timestamptz)::int as n90,
                     count(*) filter (where l.created_at >= ${ninetyAgo.toISOString()}::timestamptz and l.status = 'converted')::int as c90
              from public.leads l where l.tenant_id = ${t} and l.deleted_at is null${ownerIs(sql`l.owner_id`, scope)}`,
        )
      : [];
    const [conv] = can("inbox.view")
      ? await rows<{ open: number; unread: number }>(
          tx,
          sql`select count(*)::int as open, coalesce(sum(c.unread_count), 0)::int as unread
              from public.conversations c
              where c.tenant_id = ${t} and c.status = 'open'${scope.agentScoped ? sql` and c.assignee_id = ${me}` : sql``}`,
        )
      : [];
    const [task] =
      can("tasks.view") && me
        ? await rows<{ today: number; overdue: number }>(
            tx,
            sql`select count(*) filter (where t.due_at >= ${startToday.toISOString()}::timestamptz and t.due_at < ${startTomorrow.toISOString()}::timestamptz)::int as today,
                       count(*) filter (where t.due_at < ${startToday.toISOString()}::timestamptz)::int as overdue
                from public.tasks t
                where t.tenant_id = ${t} and t.assignee_id = ${me} and t.status in ('open', 'in_progress')`,
          )
        : [];
    const wonSeries = can("deals.view")
      ? await rows<{ bucket: string; n: number; v: number }>(
          tx,
          sql`select ${bucketExpr(sql`d.won_at`, scope, "month")} as bucket, count(*)::int as n, coalesce(sum(d.value_cents), 0)::float8 as v
              from public.deals d
              where d.tenant_id = ${t} and d.status = 'won' and d.deleted_at is null and d.currency = ${scope.currency}
                and d.won_at >= ${startOfLocalDay(yearAgoMonth, tz).toISOString()}::timestamptz${ownerIs(sql`d.owner_id`, scope)}
              group by 1`,
        )
      : [];
    const pipelines = can("deals.view") ? await listPipelines(tx, t) : [];
    const defaultPipeline = pipelines[0] ?? null;
    const stageRows = defaultPipeline ? await stageSnapshot(tx, scope, defaultPipeline.id) : [];
    const myTasks =
      can("tasks.view") && me
        ? await rows<{ id: string; title: string; due_at: Date | null; priority: string; contact_id: string | null; first_name: string | null; last_name: string | null }>(
            tx,
            sql`select t.id, t.title, t.due_at, t.priority, t.contact_id, c.first_name, c.last_name
                from public.tasks t left join public.contacts c on c.id = t.contact_id
                where t.tenant_id = ${t} and t.assignee_id = ${me} and t.status in ('open', 'in_progress')
                  and t.due_at < ${startTomorrow.toISOString()}::timestamptz
                order by t.due_at asc limit 6`,
          )
        : [];
    const closing = can("deals.view")
      ? await rows<{ id: string; title: string; value_cents: number; currency: string; expected_close_date: string; p: number; stage: string }>(
          tx,
          sql`select d.id, d.title, d.value_cents::float8 as value_cents, d.currency, to_char(d.expected_close_date, 'YYYY-MM-DD') as expected_close_date,
                     coalesce(d.probability, s.probability) as p, s.name as stage
              from public.deals d join public.pipeline_stages s on s.id = d.stage_id
              where d.tenant_id = ${t} and d.status = 'open' and d.deleted_at is null
                and d.expected_close_date >= ${today}::date and d.expected_close_date <= ${addDaysLocal(today, 14)}::date${ownerIs(sql`d.owner_id`, scope)}
              order by d.expected_close_date, d.value_cents desc limit 6`,
        )
      : [];
    const activity = await rows<{
      id: string;
      type: string;
      subject: string | null;
      occurred_at: Date;
      actor_name: string | null;
      actor_type: string;
      contact_id: string | null;
      first_name: string | null;
      last_name: string | null;
      deal_id: string | null;
      deal_title: string | null;
      company_id: string | null;
      company_name: string | null;
      lead_id: string | null;
    }>(
      tx,
      sql`select a.id, a.type, a.subject, a.occurred_at, nullif(p.full_name, '') as actor_name, a.actor_type,
                 a.contact_id, c.first_name, c.last_name, a.deal_id, d.title as deal_title,
                 a.company_id, co.name as company_name, a.lead_id
          from public.activities a
          left join public.profiles p on p.id = a.actor_id
          left join public.contacts c on c.id = a.contact_id
          left join public.deals d on d.id = a.deal_id
          left join public.companies co on co.id = a.company_id
          where a.tenant_id = ${t}${scope.agentScoped ? sql` and a.actor_id = ${me}` : sql``}
          order by a.occurred_at desc limit 10`,
    );
    const name = (f: string | null, l: string | null) => `${f ?? ""} ${l ?? ""}`.trim() || null;
    const wonM = Math.round(num(deal?.won_m));
    const wonLm = Math.round(num(deal?.won_lm));
    const monthKeys = Array.from({ length: 12 }, (_, i) => addMonths(yearAgoMonth, i));
    return {
      currency: scope.currency,
      timeZone: tz,
      agentScoped: scope.agentScoped,
      hasData: { contacts: num(counts?.contacts), deals: num(counts?.deals), leads: num(counts?.leads) },
      kpis: {
        openPipelineCents: Math.round(num(deal?.open_v)),
        openDeals: num(deal?.open_n),
        weightedPipelineCents: Math.round(num(deal?.open_w)),
        wonThisMonthCents: wonM,
        wonLastMonthCents: wonLm,
        wonChangePct: percentChange(wonM, wonLm),
        newLeadsThisWeek: num(lead?.week),
        conversionRate90d: ratio(num(lead?.c90), num(lead?.n90)),
        leads90d: num(lead?.n90),
        openConversations: num(conv?.open),
        unreadMessages: num(conv?.unread),
        tasksDueToday: num(task?.today),
        tasksOverdue: num(task?.overdue),
      },
      wonByMonth: fillBuckets(
        monthKeys,
        wonSeries.map((s) => ({ bucket: s.bucket, wonValueCents: Math.round(num(s.v)), wonCount: num(s.n) })),
        (bucket) => ({ bucket, wonValueCents: 0, wonCount: 0 }),
      ),
      pipeline: {
        pipelineName: defaultPipeline?.name ?? null,
        stages: stageRows
          .filter((s) => s.kind === "open")
          .map((s) => ({ name: s.name, color: s.color, valueCents: Math.round(num(s.v)), count: num(s.n) })),
      },
      myTasksToday: myTasks.map((x) => ({
        id: x.id,
        title: x.title,
        dueAt: x.due_at ? new Date(x.due_at) : null,
        priority: x.priority,
        overdue: x.due_at ? new Date(x.due_at) < startToday : false,
        contactId: x.contact_id,
        contactName: name(x.first_name, x.last_name),
      })),
      closingSoon: closing.map((d) => ({
        id: d.id,
        title: d.title,
        valueCents: Math.round(num(d.value_cents)),
        currency: d.currency,
        expectedCloseDate: d.expected_close_date,
        probability: num(d.p),
        stageName: d.stage,
      })),
      recentActivity: activity.map((a) => ({
        id: a.id,
        type: a.type,
        subject: a.subject,
        occurredAt: new Date(a.occurred_at),
        actorName: a.actor_name,
        actorType: a.actor_type,
        contactId: a.contact_id,
        contactName: name(a.first_name, a.last_name),
        dealId: a.deal_id,
        dealTitle: a.deal_title,
        companyId: a.company_id,
        companyName: a.company_name,
        leadId: a.lead_id,
      })),
    };
  });
}

function addDaysLocal(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + days));
  return toDateString(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

/* ----------------------------------------------------------- report runner */

export type AnyReport =
  | { key: "revenue"; data: RevenueReport }
  | { key: "pipeline"; data: PipelineReport }
  | { key: "leads"; data: LeadsReport }
  | { key: "team"; data: TeamReport }
  | { key: "customers"; data: CustomersReport };

export async function runReport(ctx: ServiceCtx, key: ReportKey, scope: Scope): Promise<AnyReport> {
  switch (key) {
    case "revenue":
      return { key, data: await revenueReport(ctx, scope) };
    case "pipeline":
      return { key, data: await pipelineReport(ctx, scope) };
    case "leads":
      return { key, data: await leadsReport(ctx, scope) };
    case "team":
      return { key, data: await teamReport(ctx, scope) };
    case "customers":
      return { key, data: await customersReport(ctx, scope) };
  }
}

/** Pipelines for the filter (default first). */
export async function pipelineOptions(ctx: ServiceCtx) {
  return ctx.run(async (tx) => (await listPipelines(tx, ctx.tenantId)).map((p) => ({ id: p.id, name: p.name, isDefault: p.is_default })));
}

/** Members visible in the owner filter (agents only see themselves). */
export async function ownerOptions(ctx: ServiceCtx, scope: Scope) {
  return ctx.run((tx) =>
    rows<{ user_id: string; name: string }>(
      tx,
      sql`select m.user_id, coalesce(nullif(p.full_name, ''), p.email) as name
          from public.memberships m join public.profiles p on p.id = m.user_id
          where m.tenant_id = ${scope.tenantId} and m.status = 'active'${scope.agentScoped ? sql` and m.user_id = ${ctx.userId}` : sql``}
          order by name`,
    ),
  );
}

