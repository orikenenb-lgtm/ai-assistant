import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bot, Calendar, CreditCard, HardDrive, Mail, MessageCircle, Receipt } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { integrationStatus, type IntegrationCard, type IntegrationState } from "@/modules/settings/integrations";
import { NoAccess } from "@/modules/settings/components/no-access";
import { Alert, Badge, Card, CardContent, PageHeader } from "@/components/ui/primitives";
import { buttonVariants } from "@/components/ui/button";

export async function generateMetadata() {
  return { title: (await getTranslations("integrations"))("title") };
}

const ICONS: Record<IntegrationCard["key"], React.ReactNode> = {
  whatsapp: <MessageCircle />,
  ai: <Bot />,
  email: <Mail />,
  calendar: <Calendar />,
  invoicing: <Receipt />,
  billing: <CreditCard />,
  storage: <HardDrive />,
};

const TONE: Record<IntegrationState, "success" | "info" | "neutral" | "danger" | "warning"> = {
  connected: "success",
  mock: "info",
  not_configured: "neutral",
  error: "danger",
  disabled: "warning",
};

export default async function IntegrationsPage() {
  const { ctx } = await requireTenant();
  if (!ctx.can("integrations.manage")) return <NoAccess />;
  const [t, tc] = await Promise.all([getTranslations("integrations"), getTranslations("common")]);
  const cards = await integrationStatus(ctx);
  const anyMock = cards.some((c) => c.state === "mock");
  const value = (v: string | number | boolean) => (typeof v === "boolean" ? (v ? tc("yes") : tc("no")) : String(v));

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      {anyMock && <Alert tone="info">{t("mockNote")}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((c) => (
          <Card key={c.key} data-testid={`integration-${c.key}`}>
            <CardContent className="flex h-full flex-col gap-4 pt-5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground [&_svg]:size-5">
                  {ICONS[c.key]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{t(`cards.${c.key}.title`)}</p>
                  <p className="text-sm text-muted-foreground">{t(`cards.${c.key}.body`)}</p>
                </div>
                <Badge tone={TONE[c.state]}>{t(`states.${c.state}`)}</Badge>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {Object.entries(c.detail).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{t(`detail.${k}` as "detail.provider")}</dt>
                    <dd className="truncate font-medium" dir="auto">
                      {value(v)}
                    </dd>
                  </div>
                ))}
              </dl>
              {c.href && (
                <div className="mt-auto flex justify-end">
                  <Link href={c.href} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    {t("manage")}
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
