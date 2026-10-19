import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CreditCard } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { getBillingOverview, listInvoices } from "@/modules/billing/service";
import { Alert, Card, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";

export async function generateMetadata() {
  return { title: (await getTranslations("billing"))("portalTitle") };
}

/** Demo billing portal for the mock provider (Stripe uses its hosted portal). */
export default async function MockPortalPage() {
  const { ctx } = await requireTenant();
  if (!ctx.can("billing.manage")) redirect("/settings/billing");
  const overview = await getBillingOverview(ctx);
  if (overview.providerKind !== "mock") redirect("/settings/billing");
  const t = await getTranslations("billing");
  const locale = (await getLocale()) as "he" | "en";
  const invoices = await listInvoices(ctx);
  return (
    <div className="space-y-6">
      <PageHeader title={t("portalTitle")} />
      <Alert tone="warning" title={t("mockTitle")}>
        {t("portalMockBody")}
      </Alert>
      <Card className="flex items-center gap-4 p-5">
        <CreditCard className="size-6 text-muted-foreground" />
        <div className="flex-1">
          <p className="font-medium">{t("paymentMethod")}</p>
          <p className="text-sm text-muted-foreground">{t("noPaymentMethod")}</p>
        </div>
      </Card>
      <Card className="p-5">
        <p className="mb-2 font-medium">{t("invoicesTitle")}</p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {invoices.map((i) => (
            <li key={i.id}>
              <span dir="ltr">{i.number}</span> · {formatMoney(i.amountCents, i.currency, locale)} · {t("sample")}
            </li>
          ))}
          {invoices.length === 0 && <li>{t("noInvoices")}</li>}
        </ul>
      </Card>
      <Button asChild variant="secondary">
        <Link href="/settings/billing">{t("backToBilling")}</Link>
      </Button>
    </div>
  );
}
