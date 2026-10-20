"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Command } from "cmdk";
import { ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/action";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";

export type ComboOption = { id: string; name: string };

/** Searchable single-select backed by a server action (companies, contacts…). */
export function AsyncCombobox({
  id,
  name,
  value,
  onChange,
  search,
  placeholder,
  disabled,
}: {
  id?: string;
  name?: string;
  value: ComboOption | null;
  onChange: (v: ComboOption | null) => void;
  search: (input: { q: string }) => Promise<ActionResult<ComboOption[]>>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const fetcher = useCallback(async (q: string) => {
    const res = await search({ q });
    return res.ok ? res.data : [];
  }, [search]);
  const { query, results: options, loading, search: runSearch } = useDebouncedSearch(fetcher);

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) runSearch(query);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {name && <input type="hidden" name={name} value={value?.id ?? ""} />}
      <div className="relative">
        <PopoverTrigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-surface px-3 text-start text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-60"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>{value?.name ?? placeholder ?? t("selectPlaceholder")}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        {value && !disabled && (
          <button
            type="button"
            className="absolute end-8 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onChange(null)}
            aria-label={t("clearFilters")}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0">
        <Command shouldFilter={false}>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Command.Input value={query} onValueChange={runSearch} placeholder={t("searchPlaceholder")} className="h-10 flex-1 bg-transparent text-sm outline-none" />
            {loading && <Spinner className="size-4 text-muted-foreground" />}
          </div>
          <Command.List className="max-h-60 overflow-y-auto p-1">
            {!loading && <Command.Empty className="py-4 text-center text-sm text-muted-foreground">{t("noResults")}</Command.Empty>}
            {options.map((o) => (
              <Command.Item
                key={o.id}
                value={o.id}
                onSelect={() => {
                  onChange(o);
                  setOpen(false);
                }}
                className="cmdk-item"
              >
                {o.name}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
