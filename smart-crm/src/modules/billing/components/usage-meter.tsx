import { cn } from "@/lib/utils";

/** Accessible usage bar: neutral below 80%, warning from 80%, danger at/over 100%. */
export function UsageMeter({
  label,
  used,
  limit,
  formatValue,
  unlimitedLabel,
}: {
  label: string;
  used: number;
  limit: number | null;
  formatValue: (n: number) => string;
  unlimitedLabel: string;
}) {
  const ratio = limit && limit > 0 ? used / limit : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const tone = limit === null ? "bg-primary" : ratio >= 1 ? "bg-danger" : ratio >= 0.8 ? "bg-warning" : "bg-primary";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular text-muted-foreground" dir="ltr">
          {formatValue(used)} / {limit === null ? unlimitedLabel : formatValue(limit)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-valuenow={used}
        aria-valuetext={limit === null ? `${formatValue(used)}` : `${formatValue(used)} / ${formatValue(limit)}`}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${limit === null ? Math.min(100, used > 0 ? 8 : 0) : pct}%` }} />
      </div>
    </div>
  );
}
