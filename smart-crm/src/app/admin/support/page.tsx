import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/modules/admin/request";
import { listSupportSessions } from "@/modules/admin/service";
import { EndSupportButton, StartSupportForm } from "@/modules/admin/components/admin-controls";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("admin.nav"))("support") };
}

export default async function AdminSupportPage() {
  const actor = await requireSuperAdmin();
  const t = await getTranslations("admin.support");
  const locale = (await getLocale()) as "he" | "en";
  const sessions = await listSupportSessions(actor);
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Alert tone="warning">{t("policy")}</Alert>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("startNew")}</CardTitle>
            <CardDescription>{t("startBody")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <StartSupportForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("sessions")}</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>{t("tenant")}</TH>
                  <TH>{t("admin")}</TH>
                  <TH className="hidden md:table-cell">{t("reason")}</TH>
                  <TH>{t("window")}</TH>
                  <TH>
                    <span className="sr-only">{t("end")}</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {sessions.map((s) => (
                  <TR key={s.id} data-testid="support-session-row">
                    <TD>
                      <Link href={`/admin/tenants/${s.tenantId}`} className="font-medium hover:underline">
                        {s.tenantName}
                      </Link>
                    </TD>
                    <TD>{s.adminName ?? "—"}</TD>
                    <TD className="hidden max-w-xs truncate text-muted-foreground md:table-cell" dir="auto">
                      {s.reason}
                    </TD>
                    <TD className="text-xs text-muted-foreground">
                      {formatDateTime(s.startedAt, locale)} → {formatDateTime(s.endedAt ?? s.expiresAt, locale)}
                      <span className="ms-2">
                        {s.active ? <Badge tone="warning">{t("active")}</Badge> : <Badge tone="neutral">{s.endedAt ? t("ended") : t("expired")}</Badge>}
                      </span>
                    </TD>
                    <TD className="text-end">{s.active && s.mine && <EndSupportButton sessionId={s.id} />}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
