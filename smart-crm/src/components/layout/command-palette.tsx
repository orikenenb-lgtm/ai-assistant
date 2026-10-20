"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { Building2, CornerDownLeft, Handshake, Plus, Search, Sparkles, Users } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { globalSearchAction } from "@/modules/search/actions";
import type { SearchHit } from "@/modules/search/service";
import { NAV, type NavKey } from "./nav";
import { useDebouncedSearch } from "@/hooks/use-debounced-search";

const HIT_ICONS = { contact: Users, company: Building2, deal: Handshake, lead: Sparkles } as const;

export function CommandPalette({ open, onOpenChange, allowedNav }: { open: boolean; onOpenChange: (v: boolean) => void; allowedNav: NavKey[] }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const tp = useTranslations("palette");
  const router = useRouter();
  const fetcher = useCallback(async (q: string) => {
    const res = await globalSearchAction({ q });
    return res.ok ? res.data : ([] as SearchHit[]);
  }, []);
  const { query, results: hits, loading, search, reset } = useDebouncedSearch(fetcher, { minLength: 2 });

  const setOpen = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const allowed = new Set(allowedNav);
  const navItems = NAV.flatMap((g) => g.items).filter((i) => allowed.has(i.key));
  const createItems = [
    { key: "contact", href: "/contacts?new=1", perm: "contacts" as NavKey },
    { key: "deal", href: "/deals?new=1", perm: "deals" as NavKey },
    { key: "lead", href: "/leads?new=1", perm: "leads" as NavKey },
    { key: "task", href: "/tasks?new=1", perm: "tasks" as NavKey },
  ].filter((c) => allowed.has(c.perm));

  // Commands stay available while typing: match the query against their labels.
  const needle = query.trim().toLocaleLowerCase();
  const matches = (label: string) => !needle || label.toLocaleLowerCase().includes(needle);
  const matchingCreate = createItems.map((c) => ({ ...c, label: tp(`new.${c.key}` as "new.contact") })).filter((c) => matches(c.label));
  const matchingNav = navItems.map((i) => ({ ...i, label: t(i.key) })).filter((i) => matches(i.label));

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <D.Content className="fixed inset-x-3 top-[12vh] z-50 mx-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-lg outline-none data-[state=open]:animate-scale-in">
          <D.Title className="sr-only">{t("commandPalette")}</D.Title>
          <Command shouldFilter={false} label={t("commandPalette")} className="flex max-h-[60vh] flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input
                value={query}
                onValueChange={search}
                placeholder={tp("placeholder")}
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                data-testid="command-input"
              />
              {loading && <Spinner className="size-4 text-muted-foreground" />}
            </div>
            <Command.List className="overflow-y-auto p-2">
              <Command.Empty className="py-8 text-center text-sm text-muted-foreground">{tc("noResults")}</Command.Empty>
              {hits.length > 0 && (
                <Command.Group heading={tp("results")} className="cmdk-group">
                  {hits.map((h) => {
                    const Icon = HIT_ICONS[h.type];
                    return (
                      <Command.Item key={`${h.type}-${h.id}`} value={`${h.type}-${h.id}`} onSelect={() => go(h.href)} className="cmdk-item">
                        <Icon className="size-4 text-muted-foreground" />
                        <span className="flex-1 truncate">{h.title}</span>
                        {h.subtitle && <span className="truncate text-xs text-muted-foreground" dir="auto">{h.subtitle}</span>}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}
              {matchingCreate.length > 0 && (
                <Command.Group heading={tp("create")} className="cmdk-group">
                  {matchingCreate.map((c) => (
                    <Command.Item key={c.key} value={`create-${c.key}`} onSelect={() => go(c.href)} className="cmdk-item">
                      <Plus className="size-4 text-muted-foreground" />
                      {c.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {matchingNav.length > 0 && (
                <Command.Group heading={tp("navigate")} className="cmdk-group">
                  {matchingNav.map((i) => (
                    <Command.Item key={i.key} value={`nav-${i.key}`} onSelect={() => go(i.href)} className="cmdk-item">
                      <CornerDownLeft className="size-4 text-muted-foreground rtl:-scale-x-100" />
                      {i.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
