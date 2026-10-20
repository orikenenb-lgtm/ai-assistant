"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Check, Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Input } from "@/components/ui/input";
import { TagPill } from "@/components/ui/primitives";
import { createTagAction } from "@/modules/crm/entity-actions";

export type TagOption = { id: string; name: string; color: string };

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];

/** Multi-select of tenant tags with inline creation. */
export function TagPicker({
  allTags,
  value,
  onChange,
  canCreate = true,
}: {
  allTags: TagOption[];
  value: string[];
  onChange: (ids: string[], created?: TagOption) => void;
  canCreate?: boolean;
}) {
  const t = useTranslations("crm");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const selected = allTags.filter((x) => value.includes(x.id));
  const filtered = allTags.filter((x) => x.name.toLowerCase().includes(query.trim().toLowerCase()));
  const exact = allTags.some((x) => x.name.toLowerCase() === query.trim().toLowerCase());
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((tag) => (
        <button key={tag.id} type="button" onClick={() => toggle(tag.id)} aria-label={t("removeTag", { name: tag.name })}>
          <TagPill name={tag.name} color={tag.color} className="hover:opacity-70" />
        </button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground">
            <Tags /> {t("addTag")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchTags")} className="mb-2 h-8" autoFocus />
          <ul className="max-h-56 overflow-y-auto">
            {filtered.map((tag) => (
              <li key={tag.id}>
                <button type="button" onClick={() => toggle(tag.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span className="flex-1 text-start">{tag.name}</span>
                  {value.includes(tag.id) && <Check className="size-4 text-primary" />}
                </button>
              </li>
            ))}
          </ul>
          {canCreate && query.trim() && !exact && (
            <Button
              type="button"
              variant="soft"
              size="sm"
              className="mt-2 w-full"
              loading={creating}
              onClick={async () => {
                setCreating(true);
                const res = await createTagAction({ name: query.trim(), color: COLORS[allTags.length % COLORS.length] });
                setCreating(false);
                if (!res.ok) return toast.error(res.error.message);
                onChange([...value, res.data.id], res.data);
                setQuery("");
              }}
            >
              <Plus /> {t("createTag", { name: query.trim() })}
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
