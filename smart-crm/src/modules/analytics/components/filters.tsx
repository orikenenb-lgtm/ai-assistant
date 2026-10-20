"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { CalendarRange, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { useUrlParams } from "@/components/data/url-state";
import { RANGE_PRESETS } from "../range";

type Option = { value: string; label: string };

/**
 * One row of filters above the report: date range first (presets, custom
 * range behind "custom"), then granularity, owner and pipeline. URL-driven so
 * every chart below shares the same slice and links are shareable.
 */
export function AnalyticsFilters({
  owners,
  pipelines,
  showPipeline,
  pipelineRequired = false,
  exportHref,
  agentScoped,
}: {
  owners: Option[];
  pipelines: Option[];
  showPipeline: boolean;
  /** The pipeline report always shows one pipeline (no "all" option). */
  pipelineRequired?: boolean;
  exportHref: string | null;
  agentScoped: boolean;
}) {
  const t = useTranslations("analytics");
  const { params, set, pending } = useUrlParams();
  const preset = params.get("preset") ?? "30d";
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");

  return (
    <div className="mb-6 flex flex-wrap items-end gap-2" aria-busy={pending || undefined} data-testid="analytics-filters">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("filters.range")}
        <NativeSelect
          value={preset}
          onChange={(e) => set({ preset: e.target.value, ...(e.target.value === "custom" ? {} : { from: null, to: null }) })}
          className="h-9 w-auto min-w-40 text-foreground"
          data-testid="range-preset"
        >
          {RANGE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(`presets.${p}`)}
            </option>
          ))}
        </NativeSelect>
      </label>
      {preset === "custom" && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to) set({ preset: "custom", from, to });
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("filters.from")}
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto" required />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("filters.to")}
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto" required />
          </label>
          <Button type="submit" variant="secondary" size="sm" className="h-9">
            <CalendarRange /> {t("filters.apply")}
          </Button>
        </form>
      )}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t("filters.interval")}
        <NativeSelect value={params.get("interval") ?? "auto"} onChange={(e) => set({ interval: e.target.value === "auto" ? null : e.target.value })} className="h-9 w-auto min-w-28 text-foreground">
          {(["auto", "day", "week", "month"] as const).map((i) => (
            <option key={i} value={i}>
              {t(`intervals.${i}`)}
            </option>
          ))}
        </NativeSelect>
      </label>
      {!agentScoped && owners.length > 1 && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.owner")}
          <NativeSelect value={params.get("owner") ?? ""} onChange={(e) => set({ owner: e.target.value || null })} className="h-9 w-auto min-w-36 text-foreground">
            <option value="">{t("filters.allTeam")}</option>
            {owners.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {showPipeline && pipelines.length > 1 && (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("filters.pipeline")}
          <NativeSelect value={params.get("pipeline") ?? (pipelineRequired ? (pipelines[0]?.value ?? "") : "")} onChange={(e) => set({ pipeline: e.target.value || null })} className="h-9 w-auto min-w-36 text-foreground">
            {!pipelineRequired && <option value="">{t("filters.allPipelines")}</option>}
            {pipelines.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {exportHref && (
        <Button asChild variant="secondary" size="sm" className="ms-auto h-9">
          <a href={exportHref} data-testid="export-csv">
            <Download /> {t("exportCsv")}
          </a>
        </Button>
      )}
    </div>
  );
}
