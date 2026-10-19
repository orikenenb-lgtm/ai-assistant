"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listNotificationsAction, markNotificationsReadAction } from "@/modules/notifications/actions";

type Item = { id: string; title: string; body: string | null; link: string | null; readAt: Date | null; createdAt: Date };

export function NotificationsBell({ initialUnread }: { initialUnread: number }) {
  const t = useTranslations("notifications");
  const tn = useTranslations("nav");
  const locale = useLocale() as "he" | "en";
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Item[] | null>(null);

  const refresh = useCallback(async () => {
    const res = await listNotificationsAction();
    if (res.ok) {
      setItems(res.data.items);
      setUnread(res.data.unread);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <Popover onOpenChange={(o) => o && refresh()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${tn("notifications")}${unread ? ` (${unread})` : ""}`} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">{tn("notifications")}</p>
          {unread > 0 && (
            <button
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              onClick={async () => {
                await markNotificationsReadAction({ ids: "all" });
                await refresh();
              }}
            >
              <CheckCheck className="size-3.5" /> {t("markAllRead")}
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items === null ? (
            <p className="p-6 text-center text-sm text-muted-foreground">…</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul>
              {items.map((n) => {
                const content = (
                  <>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{n.title}</span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                      <span className="mt-1 block text-[11px] text-muted-foreground">{formatRelative(n.createdAt, locale)}</span>
                    </span>
                  </>
                );
                return (
                  <li key={n.id} className="border-b border-border last:border-0">
                    {n.link ? (
                      <Link href={n.link} className="flex gap-3 px-4 py-3 hover:bg-accent" onClick={() => markNotificationsReadAction({ ids: [n.id] })}>
                        {content}
                      </Link>
                    ) : (
                      <div className="flex gap-3 px-4 py-3">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
