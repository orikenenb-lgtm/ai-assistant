import { formatMoney, formatNumber } from "@/lib/format";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type QuoteViewLabels = {
  items: { description: string; quantity: string; unitPrice: string; discount: string; total: string };
  totals: { subtotal: string; discount: string; beforeVat: string; vat: string; total: string };
  notes: string;
  terms: string;
};

export type QuoteViewData = {
  currency: string;
  discountBp: number;
  taxRateBp: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  terms: string | null;
  items: { id: string; description: string; quantityMilli: number; unitPriceCents: number; discountBp: number; lineTotalCents: number }[];
};

/** Read-only rendering of a quote's items and totals (staff detail page and customer page). */
export function QuoteView({ data, labels, locale }: { data: QuoteViewData; labels: QuoteViewLabels; locale: "he" | "en" }) {
  const money = (c: number) => formatMoney(c, data.currency, locale);
  return (
    <div className="space-y-6">
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH className="w-10">#</TH>
            <TH>{labels.items.description}</TH>
            <TH className="text-end">{labels.items.quantity}</TH>
            <TH className="hidden text-end sm:table-cell">{labels.items.unitPrice}</TH>
            <TH className="hidden text-end sm:table-cell">{labels.items.discount}</TH>
            <TH className="text-end">{labels.items.total}</TH>
          </TR>
        </THead>
        <TBody>
          {data.items.map((item, i) => (
            <TR key={item.id}>
              <TD className="text-muted-foreground">{i + 1}</TD>
              <TD className="whitespace-pre-wrap" dir="auto">
                {item.description}
              </TD>
              <TD className="tabular text-end">{formatNumber(item.quantityMilli / 1000, locale, { maximumFractionDigits: 3 })}</TD>
              <TD className="tabular hidden text-end sm:table-cell">{money(item.unitPriceCents)}</TD>
              <TD className="tabular hidden text-end sm:table-cell">{item.discountBp ? `${item.discountBp / 100}%` : "—"}</TD>
              <TD className="tabular text-end font-medium">{money(item.lineTotalCents)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <TotalsBox data={data} labels={labels.totals} locale={locale} />
      {data.notes && (
        <section>
          <h3 className="mb-1 text-sm font-semibold">{labels.notes}</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground" dir="auto">
            {data.notes}
          </p>
        </section>
      )}
      {data.terms && (
        <section>
          <h3 className="mb-1 text-sm font-semibold">{labels.terms}</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground" dir="auto">
            {data.terms}
          </p>
        </section>
      )}
    </div>
  );
}

export function TotalsBox({
  data,
  labels,
  locale,
}: {
  data: Pick<QuoteViewData, "currency" | "discountBp" | "taxRateBp" | "subtotalCents" | "discountCents" | "taxCents" | "totalCents">;
  labels: QuoteViewLabels["totals"];
  locale: "he" | "en";
}) {
  const money = (c: number) => formatMoney(c, data.currency, locale);
  return (
    <dl className="ms-auto w-full max-w-sm space-y-2 rounded-xl border border-border bg-surface p-4 text-sm" data-testid="quote-totals">
      <Row label={labels.subtotal} value={money(data.subtotalCents)} />
      {data.discountCents > 0 && <Row label={`${labels.discount} (${data.discountBp / 100}%)`} value={money(-data.discountCents)} />}
      <Row label={labels.beforeVat} value={money(data.subtotalCents - data.discountCents)} />
      <Row label={labels.vat} value={money(data.taxCents)} />
      <div className="border-t border-border pt-2">
        <Row label={labels.total} value={money(data.totalCents)} strong testId="quote-total" />
      </div>
    </dl>
  );
}

function Row({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) {
  return (
    <div className={strong ? "flex items-center justify-between text-base font-semibold" : "flex items-center justify-between text-muted-foreground"}>
      <dt>{label}</dt>
      <dd className="tabular text-foreground" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
