import { assertCan, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import type { AnyReport, ReportKey, Scope } from "./service";
import { runReport } from "./service";

/** Neutralizes spreadsheet formulas and quotes cells (same rules as contact export). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const money = (cents: number) => (cents / 100).toFixed(2);
const pct = (v: number | null) => (v === null ? "" : (v * 100).toFixed(1));

/** Flat rows (header first) for a report — numbers stay machine-readable. */
export function reportRows(report: AnyReport): unknown[][] {
  switch (report.key) {
    case "revenue": {
      const d = report.data;
      return [
        ["bucket_start", "won_deals", `won_value_${d.currency}`],
        ...d.series.map((s) => [s.bucket, s.wonCount, money(s.wonValueCents)]),
        [],
        ["lost_reason", "lost_deals"],
        ...d.lostReasons.map((l) => [l.label ?? "(none)", l.count]),
        [],
        ["total_won_deals", d.totals.wonCount],
        [`total_won_value_${d.currency}`, money(d.totals.wonValueCents)],
        ["total_lost_deals", d.totals.lostCount],
        ["win_rate_pct", pct(d.totals.winRate)],
      ];
    }
    case "pipeline": {
      const d = report.data;
      return [
        ["stage", "kind", "probability_pct", "open_deals", `open_value_${d.currency}`, `weighted_value_${d.currency}`, "reached_deals", "avg_days_in_stage"],
        ...d.stages.map((s) => [s.name, s.kind, s.probability, s.openCount, money(s.openValueCents), money(s.weightedValueCents), s.reachedCount, s.avgDaysInStage ?? ""]),
        [],
        ["expected_close_month", "open_deals", `value_${d.currency}`, `weighted_value_${d.currency}`],
        ...d.forecast.map((f) => [f.month, f.count, money(f.valueCents), money(f.weightedValueCents)]),
      ];
    }
    case "leads": {
      const d = report.data;
      return [
        ["bucket_start", ...d.sources],
        ...d.series.map((s) => [s.bucket, ...d.sources.map((src) => s[src] ?? 0)]),
        [],
        ["source", "leads"],
        ...d.bySource.map((s) => [s.source, s.count]),
        [],
        ["leads_created", d.totals.created],
        ["leads_converted", d.totals.converted],
        ["conversion_rate_pct", pct(d.totals.conversionRate)],
        ["median_hours_to_convert", d.totals.medianSecondsToConvert === null ? "" : (d.totals.medianSecondsToConvert / 3600).toFixed(1)],
      ];
    }
    case "team": {
      const d = report.data;
      return [
        ["member", "won_deals", `won_value_${d.currency}`, "lost_deals", "win_rate_pct", "calls", "meetings", "emails", "notes", "tasks_completed", "conversations_handled", "median_first_response_minutes"],
        ...d.members.map((m) => [
          m.name,
          m.wonCount,
          money(m.wonValueCents),
          m.lostCount,
          pct(m.winRate),
          m.activities.call,
          m.activities.meeting,
          m.activities.email,
          m.activities.note,
          m.tasksCompleted,
          m.conversationsHandled,
          m.medianFirstResponseSeconds === null ? "" : (m.medianFirstResponseSeconds / 60).toFixed(1),
        ]),
      ];
    }
    case "customers": {
      const d = report.data;
      return [
        ["bucket_start", "new_contacts"],
        ...d.series.map((s) => [s.bucket, s.created]),
        [],
        ["lifecycle_stage", "contacts"],
        ...d.lifecycle.map((l) => [l.stage, l.count]),
        [],
        ["total_contacts", d.totals.total],
        ["active_contacts", d.totals.active],
      ];
    }
  }
}

export async function exportReportCsv(ctx: ServiceCtx, key: ReportKey, scope: Scope): Promise<string> {
  assertCan(ctx, "analytics.export");
  const report = await runReport(ctx, key, scope);
  const lines = reportRows(report).map((row) => row.map(csvCell).join(","));
  await ctx.run((tx) =>
    audit(tx, ctx, {
      action: "analytics.exported",
      entityType: "report",
      entityId: key,
      metadata: { from: scope.range.fromDate, to: scope.range.toDate, ownerId: scope.ownerId, pipelineId: scope.pipelineId },
    }),
  );
  return `﻿${lines.join("\r\n")}\r\n`;
}
