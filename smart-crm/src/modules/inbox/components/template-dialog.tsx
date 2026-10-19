"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/primitives";
import { renderTemplate, templateParts } from "../templates";

export type TemplateOption = { id: string; name: string; language: string; category: string; components: unknown };

export function TemplateDialog({
  templates,
  disabled,
  prominent,
  onSend,
}: {
  templates: TemplateOption[];
  disabled?: boolean;
  prominent?: boolean;
  onSend: (input: { templateId: string; headerParams: string[]; bodyParams: string[] }) => Promise<boolean>;
}) {
  const t = useTranslations("inbox.templates");
  const tc = useTranslations("common");
  const tComposer = useTranslations("inbox.composer");
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [body, setBody] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const selected = templates.find((x) => x.id === templateId) ?? null;
  const parts = selected ? templateParts(selected.components) : null;
  const complete = parts ? header.slice(0, parts.headerParams).filter(Boolean).length === parts.headerParams && body.slice(0, parts.bodyParams).filter(Boolean).length === parts.bodyParams : false;

  const choose = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find((x) => x.id === id);
    const p = tpl ? templateParts(tpl.components) : null;
    setHeader(Array(p?.headerParams ?? 0).fill(""));
    setBody(Array(p?.bodyParams ?? 0).fill(""));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={prominent ? "primary" : "ghost"} size={prominent ? "sm" : "icon-sm"} disabled={disabled} aria-label={tComposer("template")}>
          <FileText />
          {prominent && tComposer("template")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          {templates.length === 0 && <DialogDescription>{t("none")}</DialogDescription>}
        </DialogHeader>
        {templates.length > 0 && (
          <div className="space-y-4">
            <Field label={t("choose")} htmlFor="tpl">
              <NativeSelect id="tpl" value={templateId} onChange={(e) => choose(e.target.value)}>
                <option value="">—</option>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.language})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {selected && parts && (
              <>
                <Badge tone={selected.category === "MARKETING" ? "warning" : "info"}>{t(selected.category.toLowerCase() as "utility")}</Badge>
                {header.map((v, i) => (
                  <Field key={`h${i}`} label={t("headerParam", { n: i + 1 })} htmlFor={`h${i}`}>
                    <Input id={`h${i}`} value={v} onChange={(e) => setHeader((a) => a.map((x, j) => (j === i ? e.target.value : x)))} dir="auto" />
                  </Field>
                ))}
                {body.map((v, i) => (
                  <Field key={`b${i}`} label={t("bodyParam", { n: i + 1 })} htmlFor={`b${i}`}>
                    <Input id={`b${i}`} value={v} onChange={(e) => setBody((a) => a.map((x, j) => (j === i ? e.target.value : x)))} dir="auto" />
                  </Field>
                ))}
                <div>
                  <p className="mb-1.5 text-sm font-medium">{t("preview")}</p>
                  <p className="whitespace-pre-wrap rounded-xl bg-primary-soft px-3.5 py-2 text-sm" dir="auto" data-testid="template-preview">
                    {renderTemplate(selected.components, { header, body })}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            loading={busy}
            disabled={!selected || !complete}
            onClick={async () => {
              setBusy(true);
              const ok = await onSend({ templateId, headerParams: header, bodyParams: body });
              setBusy(false);
              if (ok) {
                setOpen(false);
                choose("");
              }
            }}
          >
            {t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
