import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, initials } from "@/lib/utils";

/* ----------------------------------------------------------------- Card */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-border bg-surface shadow-xs", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-start justify-between gap-4 p-5 pb-3", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-[15px] font-semibold leading-tight", className)} {...props} />;
}
export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

/* ---------------------------------------------------------------- Badge */
export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        primary: "bg-primary-soft text-primary-soft-foreground",
        success: "bg-success-soft text-success-foreground",
        warning: "bg-warning-soft text-warning-foreground",
        danger: "bg-danger-soft text-danger-foreground",
        info: "bg-info-soft text-info-foreground",
        ai: "bg-ai-soft text-ai-foreground",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);
export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Colored tag pill — color comes from user data, so it is applied inline. */
export function TagPill({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium", className)}
    >
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {name}
    </span>
  );
}

/* --------------------------------------------------------------- Avatar */
const AVATAR_TONES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6"];
export function Avatar({ name, size = "md", className }: { name: string | null | undefined; size?: "xs" | "sm" | "md" | "lg"; className?: string }) {
  const text = name ?? "";
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white",
        AVATAR_TONES[hash % AVATAR_TONES.length],
        { xs: "size-5 text-[9px]", sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-12 text-base" }[size],
        className,
      )}
      aria-hidden
    >
      {initials(text)}
    </span>
  );
}

/* ------------------------------------------------------------- Skeleton */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} aria-hidden {...props} />;
}

/* ------------------------------------------------------------ Separator */
export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" className={cn(vertical ? "w-px self-stretch" : "h-px w-full", "bg-border", className)} />;
}

/* ------------------------------------------------------------------ Kbd */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground", className)}
      {...props}
    />
  );
}

/* --------------------------------------------------------------- Layout */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary-soft-foreground [&_svg]:size-6">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger" | "ai";
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-info/30 bg-info-soft text-info-foreground",
    success: "border-success/30 bg-success-soft text-success-foreground",
    warning: "border-warning/40 bg-warning-soft text-warning-foreground",
    danger: "border-danger/30 bg-danger-soft text-danger-foreground",
    ai: "border-ai/30 bg-ai-soft text-ai-foreground",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1", "leading-relaxed")}>{children}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  trend?: { value: string; positive: boolean } | null;
  className?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {(hint || trend) && (
        <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          {trend && <span className={trend.positive ? "text-success-foreground" : "text-danger-foreground"}>{trend.value}</span>}
          {hint}
        </p>
      )}
    </Card>
  );
}
