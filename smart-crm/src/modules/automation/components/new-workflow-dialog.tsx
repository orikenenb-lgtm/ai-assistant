"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { createWorkflowAction } from "../actions";

export type TemplateOption = { key: string; name: { he: string; en: string }; description: { he: string; en: string } };

export function NewWorkflowDialog({ templates }: { templates: TemplateOption[] }) {
  const t = useTranslations("automation");
  const tc = useTranslations("common");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("blank");
  const { run, pending, fieldErrors } = useServerAction(createWorkflowAction, { onSuccess: ({ id }) => router.push(`/automations/${id}`) });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> {t("new")}
        </Button>
      </DialogTrigger>
      <DialogContent size="lg" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("new")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run({ name: name.trim(), templateKey: template });
          }}
        >
          <Field label={t("name")} htmlFor="wf-new-name" error={fieldErrors.name} required>
            <Input id="wf-new-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t("chooseTemplate")}</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {templates.map((tpl) => {
                const active = tpl.key === template;
                return (
                  <button
                    key={tpl.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setTemplate(tpl.key);
                      if (!name.trim() && tpl.key !== "blank") setName(tpl.name[locale]);
                    }}
                    className={cn(
                      "relative rounded-xl border p-3 text-start transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                      active ? "border-primary bg-primary-soft/50" : "border-border hover:bg-accent",
                    )}
                  >
                    {active && <Check className="absolute end-3 top-3 size-4 text-primary" aria-hidden />}
                    <span className="block pe-6 text-sm font-medium">{tpl.name[locale]}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{tpl.description[locale]}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
