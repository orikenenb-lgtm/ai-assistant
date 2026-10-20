"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { AsyncCombobox, type ComboOption } from "@/components/data/async-combobox";
import { useServerAction } from "@/hooks/use-server-action";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { searchCompaniesAction, searchContactsAction } from "@/modules/crm/lookup-actions";
import { createQuoteAction, searchDealsForQuoteAction, updateQuoteAction } from "../actions";
import { CURRENCIES } from "../schemas";
import { computeQuoteTotals, parseMoney, parsePercent, parseQuantity } from "../totals";
import { TotalsBox } from "./quote-view";

export type EditorItem = { description: string; quantity: string; unitPrice: string; discountPercent: string };

export type QuoteEditorInitial = {
  id?: string;
  title: string;
  language: "he" | "en";
  currency: string;
  issueDate: string;
  validUntil: string | null;
  taxRatePercent: string;
  discountPercent: string;
  notes: string;
  terms: string;
  templateId: string | null;
  contact: ComboOption | null;
  company: ComboOption | null;
  deal: ComboOption | null;
  items: EditorItem[];
};

type Row = EditorItem & { key: number };

export function QuoteEditor({ initial, templates }: { initial: QuoteEditorInitial; templates: { id: string; name: string; terms: string | null }[] }) {
  const t = useTranslations("quotes");
  const tc = useTranslations("common");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const nextKey = useRef(initial.items.length);
  const [form, setForm] = useState(() => ({ ...initial, validUntil: initial.validUntil ?? "" }));
  const [rows, setRows] = useState<Row[]>(() => initial.items.map((item, i) => ({ ...item, key: i })));
  const editing = Boolean(initial.id);
  const create = useServerAction(createQuoteAction, { successMessage: tc("saved") });
  const update = useServerAction(updateQuoteAction, { successMessage: tc("saved") });
  const action = editing ? update : create;
  const errors = action.fieldErrors;

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  // Line errors appear once a line was edited or a save was attempted (not on a fresh line).
  const [touched, setTouched] = useState<Set<number>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const setRow = (key: number, patch: Partial<EditorItem>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setTouched((t) => (t.has(key) ? t : new Set(t).add(key)));
  };
  const addRow = () => {
    const key = nextKey.current++;
    setRows((rs) => [...rs, { key, description: "", quantity: "1", unitPrice: "", discountPercent: "0" }]);
  };
  const move = (index: number, delta: number) =>
    setRows((rs) => {
      const next = [...rs];
      const [r] = next.splice(index, 1);
      next.splice(index + delta, 0, r);
      return next;
    });

  // Live preview with the exact function the server uses; invalid lines count as zero.
  const preview = useMemo(() => {
    const parsed = rows.map((r) => {
      const q = parseQuantity(r.quantity);
      const p = parseMoney(r.unitPrice);
      const d = parsePercent(r.discountPercent || "0");
      return q !== null && p !== null && d !== null ? { quantityMilli: q, unitPriceCents: p, discountBp: d } : null;
    });
    const totals = computeQuoteTotals({
      lines: parsed.map((l) => l ?? { quantityMilli: 1, unitPriceCents: 0, discountBp: 0 }),
      discountBp: parsePercent(form.discountPercent || "0") ?? 0,
      taxRateBp: parsePercent(form.taxRatePercent || "0") ?? 0,
    });
    return { totals, invalid: parsed.map((l) => l === null) };
  }, [rows, form.discountPercent, form.taxRatePercent]);

  const submit = async () => {
    const payload = {
      title: form.title,
      language: form.language,
      contactId: form.contact?.id ?? null,
      companyId: form.company?.id ?? null,
      dealId: form.deal?.id ?? null,
      templateId: form.templateId,
      issueDate: form.issueDate,
      validUntil: form.validUntil || null,
      currency: form.currency,
      taxRatePercent: form.taxRatePercent,
      discountPercent: form.discountPercent || "0",
      notes: form.notes,
      terms: form.terms,
      items: rows.map(({ description, quantity, unitPrice, discountPercent }) => ({ description, quantity, unitPrice, discountPercent: discountPercent || "0" })),
    };
    const res = editing ? await update.run({ id: initial.id, data: payload }) : await create.run(payload);
    if (!res.ok) return;
    if (editing) router.refresh();
    else router.push(`/quotes/${res.data.id}`);
  };

  const fieldError = (k: string) => errors[k] ?? errors[`data.${k}`];
  const money = (c: number) => formatMoney(c, form.currency, locale);

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        setAttempted(true);
        e.preventDefault();
        void submit();
      }}
    >
      {action.error && !action.error.fieldErrors && <Alert tone="danger">{action.error.message}</Alert>}
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("fields.title")} htmlFor="title" error={fieldError("title")} required className="sm:col-span-2 lg:col-span-3">
            <Input id="title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={t("fields.titlePlaceholder")} maxLength={200} dir="auto" />
          </Field>
          <Field label={t("fields.contact")} htmlFor="contact" error={fieldError("contactId")}>
            <AsyncCombobox id="contact" value={form.contact} onChange={(v) => set("contact", v)} search={searchContactsAction} />
          </Field>
          <Field label={t("fields.company")} htmlFor="company" error={fieldError("companyId")}>
            <AsyncCombobox id="company" value={form.company} onChange={(v) => set("company", v)} search={searchCompaniesAction} />
          </Field>
          <Field label={t("fields.deal")} htmlFor="deal" error={fieldError("dealId")}>
            <AsyncCombobox id="deal" value={form.deal} onChange={(v) => set("deal", v)} search={searchDealsForQuoteAction} />
          </Field>
          <Field label={t("fields.issueDate")} htmlFor="issueDate" error={fieldError("issueDate")}>
            <Input id="issueDate" type="date" value={form.issueDate} onChange={(e) => set("issueDate", e.target.value)} />
          </Field>
          <Field label={t("fields.validUntil")} htmlFor="validUntil" error={fieldError("validUntil")}>
            <Input id="validUntil" type="date" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("fields.currency")} htmlFor="currency">
              <NativeSelect id="currency" value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("fields.language")} htmlFor="language">
              <NativeSelect id="language" value={form.language} onChange={(e) => set("language", e.target.value as "he" | "en")}>
                <option value="he">עברית</option>
                <option value="en">English</option>
              </NativeSelect>
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("items.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {fieldError("items") && <Alert tone="danger">{fieldError("items")![0]}</Alert>}
          <div className="hidden grid-cols-[1fr_90px_120px_80px_120px_88px] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
            <span>{t("items.description")}</span>
            <span>{t("items.quantity")}</span>
            <span>{t("items.unitPrice")}</span>
            <span>{t("items.discount")}</span>
            <span className="text-end">{t("items.total")}</span>
            <span />
          </div>
          <ol className="space-y-3">
            {rows.map((row, i) => {
              const n = i + 1;
              const err = (k: string) => fieldError(`items.${i}.${k}`);
              const lineInvalid = preview.invalid[i] && (attempted || touched.has(row.key));
              return (
                <li
                  key={row.key}
                  className={cn(
                    "grid grid-cols-3 gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_90px_120px_80px_120px_88px] md:items-start md:border-0 md:p-1",
                    lineInvalid && "md:bg-danger-soft/30",
                  )}
                  data-testid="quote-item"
                >
                  <Field error={err("description")} className="col-span-3 md:col-span-1">
                    <Textarea
                      value={row.description}
                      onChange={(e) => setRow(row.key, { description: e.target.value })}
                      aria-label={`${t("items.description")} ${n}`}
                      placeholder={t("items.description")}
                      rows={1}
                      className="min-h-9 py-1.5"
                      maxLength={500}
                      dir="auto"
                    />
                  </Field>
                  <ItemCell label={t("items.quantity")} error={err("quantity")}>
                    <Input value={row.quantity} onChange={(e) => setRow(row.key, { quantity: e.target.value })} aria-label={`${t("items.quantity")} ${n}`} inputMode="decimal" dir="ltr" />
                  </ItemCell>
                  <ItemCell label={t("items.unitPrice")} error={err("unitPrice")}>
                    <Input value={row.unitPrice} onChange={(e) => setRow(row.key, { unitPrice: e.target.value })} aria-label={`${t("items.unitPrice")} ${n}`} inputMode="decimal" dir="ltr" />
                  </ItemCell>
                  <ItemCell label={t("items.discount")} error={err("discountPercent")}>
                    <Input value={row.discountPercent} onChange={(e) => setRow(row.key, { discountPercent: e.target.value })} aria-label={`${t("items.discount")} ${n}`} inputMode="decimal" dir="ltr" />
                  </ItemCell>
                  <p className="tabular col-span-2 flex h-9 items-center gap-2 text-sm font-medium md:col-span-1 md:justify-end" aria-live="polite">
                    <span className="font-normal text-muted-foreground md:hidden">{t("items.total")}:</span>
                    {lineInvalid ? <span className="text-danger-foreground">{t("items.invalidLine")}</span> : money(preview.totals.lines[i].totalCents)}
                  </p>
                  <div className="flex items-center justify-end gap-0.5">
                    <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("items.moveUp", { n })}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t("items.moveDown", { n })}>
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="danger-ghost"
                      size="icon-sm"
                      disabled={rows.length === 1}
                      onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                      aria-label={t("items.remove", { n })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
          <Button type="button" variant="secondary" size="sm" onClick={addRow}>
            <Plus /> {t("items.add")}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardContent className="space-y-4 p-5">
            {templates.length > 0 && (
              <Field label={t("fields.template")} htmlFor="templateId">
                <NativeSelect
                  id="templateId"
                  value={form.templateId ?? ""}
                  onChange={(e) => {
                    const tpl = templates.find((x) => x.id === e.target.value);
                    setForm((f) => ({ ...f, templateId: tpl?.id ?? null, terms: f.terms.trim() ? f.terms : (tpl?.terms ?? "") }));
                  }}
                >
                  <option value="">{tc("none")}</option>
                  {templates.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field label={t("fields.notes")} htmlFor="notes" error={fieldError("notes")}>
              <Textarea id="notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={5000} dir="auto" />
            </Field>
            <Field label={t("fields.terms")} htmlFor="terms" error={fieldError("terms")}>
              <Textarea id="terms" value={form.terms} onChange={(e) => set("terms", e.target.value)} rows={4} maxLength={5000} dir="auto" />
            </Field>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("fields.discount")} htmlFor="discountPercent" error={fieldError("discountPercent")}>
              <Input id="discountPercent" value={form.discountPercent} onChange={(e) => set("discountPercent", e.target.value)} inputMode="decimal" dir="ltr" />
            </Field>
            <Field label={t("fields.taxRate")} htmlFor="taxRatePercent" error={fieldError("taxRatePercent")}>
              <Input id="taxRatePercent" value={form.taxRatePercent} onChange={(e) => set("taxRatePercent", e.target.value)} inputMode="decimal" dir="ltr" />
            </Field>
          </div>
          <TotalsBox
            locale={locale}
            data={{
              currency: form.currency,
              discountBp: parsePercent(form.discountPercent || "0") ?? 0,
              taxRateBp: parsePercent(form.taxRatePercent || "0") ?? 0,
              ...preview.totals,
            }}
            labels={{
              subtotal: t("totals.subtotal"),
              discount: t("totals.discount"),
              beforeVat: t("totals.beforeVat"),
              vat: t("totals.vat", { rate: form.taxRatePercent || "0" }),
              total: t("totals.total"),
            }}
          />
          <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
          <Button type="submit" size="lg" className="w-full" loading={action.pending}>
            <Save /> {t("actions.saveDraft")}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** A numeric item input; on mobile (no column header row) it gets its own small caption. */
function ItemCell({ label, error, children }: { label: string; error?: string[]; children: React.ReactElement }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-xs text-muted-foreground md:hidden" aria-hidden>
        {label}
      </span>
      <Field error={error}>{children}</Field>
    </div>
  );
}
