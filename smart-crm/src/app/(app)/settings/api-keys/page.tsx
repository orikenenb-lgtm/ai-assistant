import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { db } from "@/server/db";
import { getEntitlements } from "@/modules/billing/entitlements";
import { API_SCOPES, listApiKeys } from "@/modules/api/keys";
import { ApiKeysManager, type ApiKeyRow } from "@/modules/api/components/api-keys-manager";
import { NoAccess } from "@/modules/settings/components/no-access";
import { env } from "@/server/env";
import { Alert, PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("apiKeys"))("title") };
}

export default async function ApiKeysPage() {
  const { ctx } = await requireTenant();
  if (!ctx.can("api_keys.manage")) return <NoAccess />;
  const ent = await getEntitlements(db(), ctx.tenantId);
  if (!ent.features.has("api")) return <NoAccess reason="plan" />;
  const t = await getTranslations("apiKeys");
  const keys = await listApiKeys(ctx);
  const now = new Date();
  const rows: ApiKeyRow[] = keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    status: k.revokedAt ? "revoked" : k.expiresAt && k.expiresAt <= now ? "expired" : "active",
  }));
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ApiKeysManager keys={rows} scopes={API_SCOPES} canEdit={!ctx.readOnly} />
      <Alert tone="info" title={t("docs")}>
        <pre className="mt-1 overflow-x-auto whitespace-pre font-mono text-xs" dir="ltr">
          {`curl ${env().APP_URL}/api/v1/contacts \\\n  -H "Authorization: Bearer sck_…"`}
        </pre>
      </Alert>
    </div>
  );
}
