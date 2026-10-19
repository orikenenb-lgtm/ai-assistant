"use client";

import { Input } from "@/components/ui/input";
import { useUrlParams } from "@/components/data/url-state";

/** <input type="date"> bound to a URL search param (resets pagination). */
export function UrlDateInput({ param, label }: { param: string; label: string }) {
  const { params, set } = useUrlParams();
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="whitespace-nowrap">{label}</span>
      <Input type="date" className="h-9 w-auto" value={params.get(param) ?? ""} onChange={(e) => set({ [param]: e.target.value || null })} aria-label={label} />
    </label>
  );
}
