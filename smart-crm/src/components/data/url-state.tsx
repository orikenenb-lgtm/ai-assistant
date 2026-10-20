"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** Updates URL search params (resetting pagination) without a full reload. */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (updates: Record<string, string | null | undefined>, opts: { keepPage?: boolean } = {}) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!opts.keepPage && !("page" in updates)) next.delete("page");
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { params, set, pending };
}

export function SearchInput({ param = "q", placeholder, className }: { param?: string; placeholder?: string; className?: string }) {
  const t = useTranslations("common");
  const { params, set, pending } = useUrlParams();
  const [value, setValue] = useState(params.get(param) ?? "");
  useEffect(() => {
    const current = params.get(param) ?? "";
    if (value === current) return;
    const h = setTimeout(() => set({ [param]: value.trim() || null }), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? t("searchPlaceholder")}
        className="ps-9 pe-9"
        aria-label={placeholder ?? t("search")}
        type="search"
      />
      <span className="absolute end-3 top-1/2 -translate-y-1/2">
        {pending ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : value ? (
          <button type="button" onClick={() => setValue("")} aria-label={t("clearFilters")} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        ) : null}
      </span>
    </div>
  );
}

export function FilterSelect({
  param,
  label,
  options,
  allLabel,
  className,
}: {
  param: string;
  label: string;
  options: { value: string; label: string }[];
  allLabel?: string;
  className?: string;
}) {
  const t = useTranslations("common");
  const { params, set } = useUrlParams();
  return (
    <NativeSelect
      aria-label={label}
      value={params.get(param) ?? ""}
      onChange={(e) => set({ [param]: e.target.value || null })}
      className={cn("h-9 w-auto min-w-36", className)}
    >
      <option value="">
        {label}: {allLabel ?? t("all")}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const t = useTranslations("common");
  const { set, pending } = useUrlParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span className="tabular">{t("showing", { from, to, total })}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1 || pending} onClick={() => set({ page: String(page - 1) })} aria-label={t("previous")}>
          <ChevronRight className="ltr:rotate-180" />
        </Button>
        <span className="tabular">{t("pageOf", { page, pages })}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages || pending} onClick={() => set({ page: String(page + 1) })} aria-label={t("next")}>
          <ChevronLeft className="ltr:rotate-180" />
        </Button>
      </div>
    </div>
  );
}
