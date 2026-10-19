import { getTranslations } from "next-intl/server";
import { CheckCircle2, Lock, MessageCircle, ShieldCheck, XCircle } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { getEntitlements } from "@/modules/billing/entitlements";
import { listAccounts, listTemplates, mockAllowed } from "@/modules/whatsapp/accounts";
import { AccountCard, ConnectAccountDialog, CopyValue, SimulatorPanel } from "@/modules/whatsapp/components/settings-panels";
import { Alert, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("whatsapp"))("title") };
}

function Configured({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "flex items-center gap-1.5 text-success-foreground" : "flex items-center gap-1.5 text-warning-foreground"}>
      {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />} {label}
    </span>
  );
}

export default async function WhatsAppSettingsPage() {
  const { ctx } = await requireTenant();
  const t = await getTranslations("whatsapp");
  const tAll = await getTranslations();
  if (!ctx.can("integrations.manage")) return <EmptyState icon={<Lock />} title={tAll("errors.forbidden")} />;

  const ent = await getEntitlements(db(), ctx.tenantId);
  if (!ent.features.has("whatsapp")) {
    return <EmptyState icon={<MessageCircle />} title={tAll("inbox.empty.planTitle")} description={tAll("inbox.empty.planBody")} />;
  }

  const [accounts, templates] = await Promise.all([listAccounts(ctx), listTemplates(ctx)]);
  const e = env();
  const mock = mockAllowed();
  const readOnly = ctx.readOnly;
  const callbackUrl = new URL("/api/webhooks/whatsapp", e.APP_URL).toString();
  const mockAccounts = accounts.filter((a) => a.provider === "mock" && a.status === "active");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} actions={!readOnly && <ConnectAccountDialog mockAvailable={mock} />} />

      <Alert tone="info">
        <span className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" /> {t("official")}
        </span>
      </Alert>

      <section className="space-y-3" aria-labelledby="wa-accounts">
        <h2 id="wa-accounts" className="text-base font-semibold">
          {t("accounts")}
        </h2>
        {accounts.length === 0 ? (
          <EmptyState icon={<MessageCircle />} title={t("noAccounts")} description={t("noAccountsBody")} />
        ) : (
          accounts.map((a) => <AccountCard key={a.id} account={a} templates={templates.filter((x) => x.accountId === a.id)} readOnly={readOnly} />)
        )}
      </section>

      <Card>
        <CardHeader className="flex-col gap-1">
          <CardTitle>{t("webhook.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("webhook.body")}</p>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <p className="font-medium">{t("webhook.callback")}</p>
            <CopyValue value={callbackUrl} />
          </div>
          <ul className="space-y-2">
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span>{t("webhook.verifyToken")}</span>
              <Configured ok={Boolean(e.META_WEBHOOK_VERIFY_TOKEN)} label={e.META_WEBHOOK_VERIFY_TOKEN ? t("webhook.configured") : t("webhook.notConfigured")} />
            </li>
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span>{t("webhook.appSecret")}</span>
              <Configured ok={Boolean(e.META_APP_SECRET)} label={e.META_APP_SECRET ? t("webhook.configured") : t("webhook.notConfigured")} />
            </li>
          </ul>
          <p className="text-muted-foreground">{t("webhook.fields")}</p>
        </CardContent>
      </Card>

      {mock && !readOnly && mockAccounts.length > 0 && (
        <SimulatorPanel accounts={mockAccounts.map((a) => ({ id: a.id, displayName: a.displayName }))} signingConfigured={Boolean(e.META_APP_SECRET)} />
      )}
    </div>
  );
}
