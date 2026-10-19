"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FileText, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Switch } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Label, Textarea } from "@/components/ui/input";
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { useServerAction } from "@/hooks/use-server-action";
import { deleteTemplateAction, saveDocumentSettingsAction, saveTemplateAction, setMockAccountingAction } from "../actions";

export type TemplateRow = {
  id: string;
  name: string;
  isDefault: boolean;
  headerText: string | null;
  footerText: string | null;
  terms: string | null;
  accentColor: string;
  showLogo: boolean;
};

export function TemplatesCard({ templates, canEdit }: { templates: TemplateRow[]; canEdit: boolean }) {
  const t = useTranslations("documents");
  const tc = useTranslations("common");
  const router = useRouter();
  return (
    <Card>
      <CardHeader className="items-center">
        <div>
          <CardTitle>{t("templates")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </div>
        {canEdit && (
          <TemplateDialog
            trigger={
              <Button size="sm">
                <Plus /> {t("newTemplate")}
              </Button>
            }
          />
        )}
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <EmptyState icon={<FileText />} title={t("newTemplate")} description={t("subtitle")} />
        ) : (
          <ul className="divide-y divide-border">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-center gap-3 py-3" data-testid="template-row">
                <span className="size-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: tpl.accentColor }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" dir="auto">
                    {tpl.name}
                  </p>
                  {tpl.terms && (
                    <p className="truncate text-xs text-muted-foreground" dir="auto">
                      {tpl.terms}
                    </p>
                  )}
                </div>
                {tpl.isDefault && <Badge tone="primary">{t("default")}</Badge>}
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <TemplateDialog
                      initial={tpl}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={`${tc("edit")} ${tpl.name}`}>
                          <Pencil />
                        </Button>
                      }
                    />
                    {!tpl.isDefault && (
                      <ConfirmDialog
                        trigger={
                          <Button variant="danger-ghost" size="icon-sm" aria-label={`${tc("delete")} ${tpl.name}`}>
                            <Trash2 />
                          </Button>
                        }
                        description={t("deleteConfirm", { name: tpl.name })}
                        onConfirm={async () => {
                          const res = await deleteTemplateAction({ id: tpl.id });
                          if (!res.ok) return void toast.error(res.error.message);
                          toast.success(tc("deleted"));
                          router.refresh();
                        }}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const EMPTY: Omit<TemplateRow, "id"> = { name: "", isDefault: false, headerText: "", footerText: "", terms: "", accentColor: "#4f46e5", showLogo: true };

function TemplateDialog({ initial, trigger }: { initial?: TemplateRow; trigger: React.ReactNode }) {
  const t = useTranslations("documents");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Omit<TemplateRow, "id">>(EMPTY);
  const save = useServerAction(saveTemplateAction, { successMessage: tc("saved") });
  const err = (k: string) => save.fieldErrors[`data.${k}`] ?? save.fieldErrors[k];
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onOpenChange = (o: boolean) => {
    if (o) {
      setForm(initial ? { ...initial, headerText: initial.headerText ?? "", footerText: initial.footerText ?? "", terms: initial.terms ?? "" } : EMPTY);
      save.reset();
    }
    setOpen(o);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg" closeLabel={tc("close")}>
        <form
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await save.run({ id: initial?.id, data: form });
            if (!res.ok) return;
            setOpen(false);
            router.refresh();
          }}
        >
          <DialogHeader>
            <DialogTitle>{initial ? t("editTemplate") : t("newTemplate")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("name")} htmlFor="tpl-name" error={err("name")} required className="sm:col-span-2">
              <Input id="tpl-name" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={80} dir="auto" />
            </Field>
            <Field label={t("headerText")} htmlFor="tpl-header" error={err("headerText")} className="sm:col-span-2">
              <Textarea id="tpl-header" value={form.headerText ?? ""} onChange={(e) => set("headerText", e.target.value)} rows={2} maxLength={1000} dir="auto" />
            </Field>
            <Field label={t("terms")} htmlFor="tpl-terms" error={err("terms")} className="sm:col-span-2">
              <Textarea id="tpl-terms" value={form.terms ?? ""} onChange={(e) => set("terms", e.target.value)} rows={4} maxLength={5000} dir="auto" />
            </Field>
            <Field label={t("footerText")} htmlFor="tpl-footer" error={err("footerText")} className="sm:col-span-2">
              <Textarea id="tpl-footer" value={form.footerText ?? ""} onChange={(e) => set("footerText", e.target.value)} rows={2} maxLength={1000} dir="auto" />
            </Field>
            <Field label={t("accentColor")} htmlFor="tpl-color" error={err("accentColor")}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.accentColor) ? form.accentColor : "#4f46e5"}
                  onChange={(e) => set("accentColor", e.target.value)}
                  className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-surface p-1"
                  aria-label={t("accentColor")}
                />
                <Input id="tpl-color" value={form.accentColor} onChange={(e) => set("accentColor", e.target.value)} maxLength={7} dir="ltr" />
              </div>
            </Field>
            <div className="flex flex-col justify-end gap-3 pb-1">
              <div className="flex items-center gap-2">
                <Switch id="tpl-logo" checked={form.showLogo} onCheckedChange={(v) => set("showLogo", v)} />
                <Label htmlFor="tpl-logo">{t("showLogo")}</Label>
              </div>
              {!initial?.isDefault && (
                <div className="flex items-center gap-2">
                  <Checkbox id="tpl-default" checked={form.isDefault} onCheckedChange={(v) => set("isDefault", v === true)} />
                  <Label htmlFor="tpl-default">{t("isDefault")}</Label>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={save.pending}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={save.pending}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VatSettingsCard({ defaultTaxRatePercent, canEdit }: { defaultTaxRatePercent: string; canEdit: boolean }) {
  const t = useTranslations("documents");
  const tc = useTranslations("common");
  const router = useRouter();
  const [value, setValue] = useState(defaultTaxRatePercent);
  const save = useServerAction(saveDocumentSettingsAction, { successMessage: tc("saved") });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("vatTitle")}</CardTitle>
          <CardDescription>{t("vatHelp")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await save.run({ defaultTaxRatePercent: value });
            if (res.ok) router.refresh();
          }}
        >
          <Field label={t("defaultVat")} htmlFor="default-vat" error={save.fieldErrors.defaultTaxRatePercent} className="sm:w-48">
            <Input id="default-vat" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" dir="ltr" disabled={!canEdit} />
          </Field>
          {canEdit && (
            <Button type="submit" variant="secondary" loading={save.pending}>
              {tc("save")}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function AccountingCard({
  status,
  canManage,
  mockAllowed,
}: {
  status: { connected: boolean; mock: boolean; label: string | null };
  canManage: boolean;
  mockAllowed: boolean;
}) {
  const t = useTranslations("documents");
  const tc = useTranslations("common");
  const router = useRouter();
  const action = useServerAction(setMockAccountingAction);
  const toggle = async (connected: boolean) => {
    const res = await action.run({ connected });
    if (res.ok) router.refresh();
  };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-4" /> {t("accountingTitle")}
          </CardTitle>
          <CardDescription>{t("accountingHelp")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={status.connected ? "success" : "neutral"}>
            {status.connected ? t("accountingConnected", { label: status.label ?? "" }) : t("accountingNotConnected")}
          </Badge>
          {status.mock && <Badge tone="warning">{tc("mockBadge")}</Badge>}
        </div>
        <Alert tone="info">{t("requiresApproval")}</Alert>
        {canManage &&
          (mockAllowed ? (
            status.connected ? (
              status.mock && (
                <Button variant="secondary" size="sm" loading={action.pending} onClick={() => void toggle(false)}>
                  {t("disconnect")}
                </Button>
              )
            ) : (
              <Button variant="secondary" size="sm" loading={action.pending} onClick={() => void toggle(true)}>
                {t("connectMock")}
              </Button>
            )
          ) : (
            <p className="text-xs text-muted-foreground">{t("mockOnlyDev")}</p>
          ))}
      </CardContent>
    </Card>
  );
}
