import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { db } from "@/server/db";
import { DOMAIN_EVENTS } from "@/server/events";
import { getEntitlements } from "@/modules/billing/entitlements";
import { listWebhooks } from "@/modules/webhooks/service";
import { SIGNATURE_HEADER } from "@/modules/webhooks/sign";
import { WebhooksManager } from "@/modules/webhooks/components/webhooks-manager";
import { NoAccess } from "@/modules/settings/components/no-access";
import { Alert, PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("webhooks"))("title") };
}

export default async function WebhooksPage() {
  const { ctx } = await requireTenant();
  if (!ctx.can("integrations.manage")) return <NoAccess />;
  const ent = await getEntitlements(db(), ctx.tenantId);
  if (!ent.features.has("webhooks")) return <NoAccess reason="plan" />;
  const t = await getTranslations("webhooks");
  const webhooks = await listWebhooks(ctx);
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <WebhooksManager webhooks={webhooks} events={DOMAIN_EVENTS} canEdit={!ctx.readOnly} />
      <Alert tone="info" title={t("verifyDocs")}>
        <code className="block whitespace-pre-wrap font-mono text-xs" dir="ltr">
          {`${SIGNATURE_HEADER}: t=<unix>,v1=<hex>\nv1 = HMAC_SHA256(secret, "<t>.<raw body>")`}
        </code>
      </Alert>
    </div>
  );
}
