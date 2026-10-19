"use client";

import "./viz.css";
import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBucket, formatValue, type ValueFormat } from "../format";
import type { Bucket } from "../range";

export type Slot = 1 | 2 | 3 | 4 | 5 | 6;
export type SeriesDef = { key: string; label: string; slot: Slot };
export type TableData = { head: string[]; rows: string[][] };

const color = (slot: Slot) => `var(--viz-${slot})`;

/* --------------------------------------------------------------- frame */

/**
 * Figure wrapper: title, optional legend (≥2 series), the plot, and a data
 * table that is always available to screen readers and can be toggled on
 * screen (values are never hover-only).
 */
export function ChartFrame({
  title,
  description,
  legend,
  table,
  children,
  className,
  actions,
}: {
  title: string;
  description?: string;
  legend?: SeriesDef[];
  table: TableData;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  const t = useTranslations("analytics");
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  return (
    <figure className={cn("viz-root rounded-xl border border-border bg-surface p-4 shadow-xs sm:p-5", className)} aria-labelledby={`${id}-title`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <figcaption>
          <h3 id={`${id}-title`} className="text-[15px] font-semibold leading-tight">
            {title}
          </h3>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </figcaption>
        <div className="flex items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Table2 className="size-3.5" />
            {showTable ? t("showChart") : t("showTable")}
          </button>
        </div>
      </div>
      {legend && legend.length > 1 && !showTable && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t("legend")}>
          {legend.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: color(s.slot) }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className={cn(showTable && "hidden")} aria-hidden={showTable || undefined}>
        {children}
      </div>
      <div className={cn(!showTable && "sr-only")}>
        <DataTable table={table} caption={title} />
      </div>
    </figure>
  );
}

function DataTable({ table, caption }: { table: TableData; caption: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-muted">
          <tr>
            {table.head.map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2 text-start text-xs font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="px-3 py-1.5 text-start font-normal">
                    {c}
                  </th>
                ) : (
                  <td key={j} className="tabular px-3 py-1.5 text-start">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- tooltip */

type TooltipEntry = { dataKey?: unknown; name?: unknown; value?: unknown; color?: string };

function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormatter,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: unknown;
  format: ValueFormat;
  labelFormatter: (l: string) => string;
}) {
  const locale = useLocale() as "he" | "en";
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 text-muted-foreground">{labelFormatter(String(label))}</p>
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
              {String(p.name ?? "")}
            </span>
            <span className="tabular font-semibold text-foreground">{formatValue(Number(p.value), format, locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useAxisDirection() {
  const locale = useLocale();
  const rtl = locale === "he";
  return { rtl, locale: locale as "he" | "en" };
}

const axisProps = { axisLine: false, tickLine: false } as const;

/* --------------------------------------------------------- time series */

/** Columns over time; stacked when several series. Time flows with the reading direction. */
export function TimeBars({
  data,
  series,
  bucket,
  format,
  height = 240,
  ariaLabel,
}: {
  data: Record<string, number | string>[];
  series: SeriesDef[];
  bucket: Bucket;
  format: ValueFormat;
  height?: number;
  ariaLabel: string;
}) {
  const { rtl, locale } = useAxisDirection();
  const stacked = series.length > 1;
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="bucket" {...axisProps} reversed={rtl} tickFormatter={(v) => formatBucket(String(v), bucket, locale)} minTickGap={12} interval="equidistantPreserveStart" />
          <YAxis
            {...axisProps}
            orientation={rtl ? "right" : "left"}
            width={56}
            tickFormatter={(v) => formatValue(Number(v), format, locale, { compact: true })}
            allowDecimals={format.kind !== "count"}
          />
          <Tooltip
            cursor={{ fill: "var(--viz-cursor)" }}
            content={(p) => <ChartTooltip active={p.active} payload={p.payload as ReadonlyArray<TooltipEntry>} label={p.label} format={format} labelFormatter={(l) => formatBucket(l, bucket, locale, { long: true })} />}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId={stacked ? "stack" : undefined}
              fill={color(s.slot)}
              maxBarSize={24}
              radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
              stroke={stacked ? "var(--viz-surface)" : undefined}
              strokeWidth={stacked ? 2 : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single-series trend: 2px line over a 10% wash, with a crosshair tooltip. */
export function TrendArea({
  data,
  dataKey,
  label,
  bucket,
  format,
  slot = 1,
  height = 220,
  ariaLabel,
}: {
  data: Record<string, number | string>[];
  dataKey: string;
  label: string;
  bucket: Bucket;
  format: ValueFormat;
  slot?: Slot;
  height?: number;
  ariaLabel: string;
}) {
  const { rtl, locale } = useAxisDirection();
  const gradient = useId().replace(/:/g, "");
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color(slot)} stopOpacity={0.14} />
              <stop offset="100%" stopColor={color(slot)} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="bucket" {...axisProps} reversed={rtl} tickFormatter={(v) => formatBucket(String(v), bucket, locale)} minTickGap={12} interval="equidistantPreserveStart" />
          <YAxis
            {...axisProps}
            orientation={rtl ? "right" : "left"}
            width={48}
            tickFormatter={(v) => formatValue(Number(v), format, locale, { compact: true })}
            allowDecimals={format.kind !== "count"}
          />
          <Tooltip
            cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
            content={(p) => <ChartTooltip active={p.active} payload={p.payload as ReadonlyArray<TooltipEntry>} label={p.label} format={format} labelFormatter={(l) => formatBucket(l, bucket, locale, { long: true })} />}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            name={label}
            stroke={color(slot)}
            strokeWidth={2}
            fill={`url(#${gradient})`}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--viz-surface)", strokeWidth: 2, fill: color(slot) }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------ category bars */

/**
 * Horizontal bars for nominal categories, as plain HTML: one series → one
 * color, 12px bars growing from the start edge with a rounded data-end, value
 * at the tip, long Hebrew labels truncated with a tooltip. RTL-native.
 */
export function CategoryBars({
  data,
  format,
  label,
  slot = 1,
  ariaLabel,
}: {
  data: { name: string; value: number }[];
  format: ValueFormat;
  label: string;
  slot?: Slot;
  ariaLabel: string;
}) {
  const locale = useLocale() as "he" | "en";
  const max = Math.max(0, ...data.map((d) => d.value));
  if (!data.length) return null;
  return (
    <ul className="space-y-2.5 py-1" role="img" aria-label={ariaLabel}>
      {data.map((d, i) => {
        const pct = max > 0 ? Math.max(d.value > 0 ? 1.5 : 0, (d.value / max) * 100) : 0;
        const formatted = formatValue(d.value, format, locale, { compact: true });
        return (
          <li key={`${d.name}-${i}`} className="group grid grid-cols-[minmax(0,7.5rem)_1fr] items-center gap-3 text-sm" title={`${d.name} · ${label}: ${formatValue(d.value, format, locale)}`}>
            <span className="truncate text-muted-foreground" dir="auto">
              {d.name}
            </span>
            {/* The track keeps 4rem free at its end so the value label always fits past the longest bar. */}
            <span className="relative me-16 h-5 min-w-0">
              <span
                className="absolute inset-y-1 start-0 rounded-e-[4px] transition-opacity group-hover:opacity-80"
                style={{ width: `${pct}%`, backgroundColor: color(slot) }}
                aria-hidden
              />
              <span className="tabular absolute inset-y-0 flex items-center whitespace-nowrap ps-2 text-xs font-medium text-foreground" style={{ insetInlineStart: `${pct}%` }}>
                {formatted}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
