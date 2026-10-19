import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type KpiDelta = {
  /** Relative change (0.12 = +12%); null when there is no baseline. */
  pct: number | null;
  /** Whether an increase is good news (revenue: yes, overdue tasks: no). */
  upIsGood?: boolean;
  /** e.g. "לעומת החודש שעבר" — the delta is never shown without its period. */
  periodLabel: string;
  formatted: string | null;
};

/**
 * Stat tile: label · value · optional delta (icon + signed text + period, never
 * color alone) · optional hint. Values use proportional figures.
 */
export function KpiTile({
  label,
  value,
  delta,
  hint,
  href,
  icon,
  tone,
  testId,
}: {
  label: string;
  value: string;
  delta?: KpiDelta;
  hint?: React.ReactNode;
  href?: string;
  icon?: React.ReactNode;
  tone?: "warning" | "danger";
  testId?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight",
          tone === "danger" && "text-danger-foreground",
          tone === "warning" && "text-warning-foreground",
        )}
        data-testid={testId}
      >
        {value}
      </p>
      {(delta || hint) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {delta && <DeltaBadge delta={delta} />}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </>
  );
  const cls = "block rounded-xl border border-border bg-surface p-5 shadow-xs";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function DeltaBadge({ delta }: { delta: KpiDelta }) {
  if (delta.pct === null || delta.formatted === null) {
    return (
      <span className="inline-flex items-center gap-1">
        <Minus className="size-3" aria-hidden /> {delta.periodLabel}
      </span>
    );
  }
  const up = delta.pct > 0;
  const flat = delta.pct === 0;
  const good = flat ? null : up === (delta.upIsGood ?? true);
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium",
          good === true && "text-success-foreground",
          good === false && "text-danger-foreground",
        )}
      >
        <Icon className="size-3.5 rtl:-scale-x-100" aria-hidden />
        <span dir="ltr">{delta.formatted}</span>
      </span>
      <span>{delta.periodLabel}</span>
    </span>
  );
}
