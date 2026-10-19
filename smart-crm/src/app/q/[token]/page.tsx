import { cache } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Download, FileX } from "lucide-react";
import { getPublicQuote } from "@/modules/documents/service";
import { isAwaitingDecision, type QuoteStatus } from "@/modules/documents/status";
import { QuoteView } from "@/modules/documents/components/quote-view";
import { PublicQuoteResponse, QuoteViewBeacon } from "@/modules/documents/components/public-quote-response";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";

const load = cache((token: string) => (/^[A-Za-z0-9_-]{20,100}$/.test(token) ? getPublicQuote(token) : Promise.resolve(null)));

const safeColor = (c: string | null | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#4f46e5");

export async function generateMetadata({ params }: PageProps<"/q/[token]">): Promise<Metadata> {
  const { token } = await params;
  const data = await load(token);
  const base: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
  if (!data) return base;
  const t = await getTranslations({ locale: data.quote.language === "en" ? "en" : "he", namespace: "quotes" });
  return { ...base, title: { absolute: `${t("public.quoteNumber", { number: data.quote.number })} · ${data.org.name}` } };
}

/** Customer-facing quote page reached by the emailed link. Renders in the quote's language. */
export default async function PublicQuotePage({ params }: PageProps<"/q/[token]">) {
  const { token } = await params;
  const data = await load(token);

  if (!data) {
    const t = await getTranslations("quotes");
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <FileX className="size-6" />
        </div>
        <h1 className="text-xl font-semibold">{t("public.notFoundTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("public.notFoundBody")}</p>
      </main>
    );
  }

  const { quote: q, org } = data;
  const lang = q.language === "en" ? "en" : "he";
  const dir = lang === "he" ? "rtl" : "ltr";
  const t = await getTranslations({ locale: lang, namespace: "quotes" });
  const status = q.status as QuoteStatus;
  const awaiting = isAwaitingDecision(status) && !data.expired;
  const accent = safeColor(data.accentColor);
  const customer = [data.customerName, data.companyName].filter(Boolean).join(" · ");
  const contactLine = [org.email, org.phone].filter(Boolean).join(" · ");

  return (
    <main lang={lang} dir={dir} className="min-h-screen bg-background">
      {awaiting && <QuoteViewBeacon token={token} />}
      <div className="h-1.5" style={{ backgroundColor: accent }} />
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: accent }} dir="auto">
              {org.name}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight" dir="auto">
              {q.title}
            </h1>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{t("public.quoteNumber", { number: q.number })}</span>
              <span>{t("public.issued", { date: formatDate(q.issueDate, lang, "UTC") })}</span>
              {q.validUntil && <span>{t("public.validUntil", { date: formatDate(q.validUntil, lang, "UTC") })}</span>}
            </p>
            {customer && (
              <p className="mt-1 text-sm">
                <span className="text-muted-foreground">{t("public.for")}: </span>
                <span dir="auto">{customer}</span>
              </p>
            )}
          </div>
          <Button asChild variant="secondary" size="sm">
            <a href={`/q/${token}/pdf`} download rel="nofollow">
              <Download /> {t("public.download")}
            </a>
          </Button>
        </header>

        {status === "accepted" && <Alert tone="success">{t("public.acceptedBanner", { name: q.decidedByName ?? "" })}</Alert>}
        {status === "rejected" && <Alert tone="warning">{t("public.rejectedBanner")}</Alert>}
        {(status === "expired" || data.expired) && <Alert tone="warning">{t("public.expiredBanner")}</Alert>}
        {status === "canceled" && <Alert tone="warning">{t("public.canceledBanner")}</Alert>}

        <Card>
          <CardContent className="space-y-6 p-5 sm:p-6">
            {data.headerText && (
              <p className="whitespace-pre-wrap text-sm" dir="auto">
                {data.headerText}
              </p>
            )}
            <QuoteView
              locale={lang}
              data={{
                currency: q.currency,
                discountBp: q.discountBp,
                taxRateBp: q.taxRateBp,
                subtotalCents: q.subtotalCents,
                discountCents: q.discountCents,
                taxCents: q.taxCents,
                totalCents: q.totalCents,
                notes: q.notes,
                terms: q.terms,
                items: data.items,
              }}
              labels={{
                items: {
                  description: t("items.description"),
                  quantity: t("items.quantity"),
                  unitPrice: t("items.unitPrice"),
                  discount: t("items.discount"),
                  total: t("items.total"),
                },
                totals: {
                  subtotal: t("totals.subtotal"),
                  discount: t("totals.discount"),
                  beforeVat: t("totals.beforeVat"),
                  vat: t("totals.vat", { rate: q.taxRateBp / 100 }),
                  total: t("totals.total"),
                },
                notes: t("fields.notes"),
                terms: t("fields.terms"),
              }}
            />
            {data.footerText && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground" dir="auto">
                {data.footerText}
              </p>
            )}
          </CardContent>
        </Card>

        {awaiting && (
          <Card>
            <CardContent className="p-5 sm:p-6">
              <PublicQuoteResponse
                token={token}
                dir={dir}
                labels={{
                  title: t("public.respondTitle"),
                  body: t("public.respondBody"),
                  name: t("public.name"),
                  note: t("public.note"),
                  accept: t("public.accept"),
                  reject: t("public.reject"),
                  thanks: t("public.thanks"),
                  nameInvalid: t("public.nameInvalid"),
                  rateLimited: t("public.rateLimited"),
                  error: t("public.error"),
                }}
              />
            </CardContent>
          </Card>
        )}

        <footer className="space-y-1 text-center text-xs text-muted-foreground">
          {contactLine && (
            <p dir="auto">{t("public.contact", { contact: contactLine })}</p>
          )}
          <p>{t("public.disclaimer")}</p>
        </footer>
      </div>
    </main>
  );
}
