"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarSync } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import { formatRelative } from "@/lib/format";
import { disconnectCalendarAction } from "../actions";

type Provider = { provider: "google" | "microsoft"; configured: boolean };
type Connection = { id: string; provider: string; status: string; accountEmail: string | null; lastSyncedAt: Date | null; lastError: string | null };

/** External calendar sync status — architecture only until credentials are approved. */
export function IntegrationsPanel({ providers, flagEnabled, connections, canManage }: { providers: Provider[]; flagEnabled: boolean; connections: Connection[]; canManage: boolean }) {
  const t = useTranslations("calendar.integrations");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <CalendarSync className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        {!flagEnabled && <Badge tone="neutral">{t("notLive")}</Badge>}
      </div>
      <ul className="space-y-3">
        {providers.map((p) => {
          const conn = connections.find((c) => c.provider === p.provider);
          return (
            <li key={p.provider} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(p.provider)}</p>
                <p className="text-xs text-muted-foreground">
                  {conn
                    ? conn.status === "error"
                      ? t("error", { message: conn.lastError ?? "" })
                      : `${t("connected", { email: conn.accountEmail ?? "—" })}${conn.lastSyncedAt ? ` · ${t("lastSync", { when: formatRelative(conn.lastSyncedAt, locale) })}` : ""}`
                    : p.provider === "microsoft"
                      ? t("planned")
                      : !p.configured
                        ? t("notConfigured")
                        : !flagEnabled
                          ? t("flagOff")
                          : ""}
                </p>
              </div>
              {conn ? (
                canManage && (
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    onClick={async () => {
                      const res = await disconnectCalendarAction({ id: conn.id });
                      if (!res.ok) return void toast.error(res.error.message);
                      router.refresh();
                    }}
                  >
                    {t("disconnect")}
                  </Button>
                )
              ) : (
                <Button size="sm" variant="secondary" disabled={!canManage || !p.configured || !flagEnabled} asChild={canManage && p.configured && flagEnabled}>
                  {canManage && p.configured && flagEnabled ? <a href={`/calendar/oauth/${p.provider}`}>{t("connect")}</a> : <span>{t("connect")}</span>}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
