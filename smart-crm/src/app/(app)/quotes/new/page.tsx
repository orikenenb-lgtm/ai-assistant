import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/tenancy";
import { quoteDefaults } from "@/modules/documents/service";
import { listTemplates } from "@/modules/documents/templates";
import { QuoteEditor } from "@/modules/documents/components/quote-editor";
import { Alert } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("quotes"))("new") };
}

const uuid = (v: string | string[] | undefined) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export default async function NewQuotePage({ searchParams }: PageProps<"/quotes/new">) {
  const { ctx } = await requireTenant();
  const t = await getTranslations("quotes");
  if (!ctx.can("documents.create") || ctx.readOnly) {
    return <Alert tone="danger">{(await getTranslations("errors"))("forbidden")}</Alert>;
  }
  const sp = await searchParams;
  const [defaults, templates] = await Promise.all([quoteDefaults(ctx, { dealId: uuid(sp.deal), contactId: uuid(sp.contact) }), listTemplates(ctx)]);

  const breadcrumbLabel = (await getTranslations("common"))("breadcrumb");
  return (
    <div className="space-y-6">
      <nav aria-label={breadcrumbLabel} className="text-sm text-muted-foreground">
        <Link href="/quotes" className="hover:text-foreground">
          {t("title")}
        </Link>{" "}
        / <span className="text-foreground">{t("new")}</span>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{t("new")}</h1>
      <QuoteEditor
        templates={templates.map((x) => ({ id: x.id, name: x.name, terms: x.terms }))}
        initial={{
          title: defaults.title,
          language: defaults.language,
          currency: defaults.currency,
          issueDate: defaults.issueDate,
          validUntil: defaults.validUntil,
          taxRatePercent: String(defaults.taxRateBp / 100),
          discountPercent: "0",
          notes: "",
          terms: defaults.terms ?? "",
          templateId: defaults.templateId,
          contact: defaults.contact,
          company: defaults.company,
          deal: defaults.deal ? { id: defaults.deal.id, name: defaults.deal.title } : null,
          items: defaults.items,
        }}
      />
    </div>
  );
}
