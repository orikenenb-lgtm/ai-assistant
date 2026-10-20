"use client";

import { useTranslations } from "next-intl";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import type { CustomFieldDef } from "@/modules/crm/custom-fields";

/** Renders inputs for tenant-defined custom fields; values are named `cf.<key>`. */
export function CustomFieldInputs({
  defs,
  values,
  errors,
}: {
  defs: CustomFieldDef[];
  values: Record<string, unknown>;
  errors: Record<string, string[]>;
}) {
  const t = useTranslations("common");
  if (!defs.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {defs.map((d) => {
        const id = `cf-${d.key}`;
        const name = `cf.${d.key}`;
        const v = values[d.key];
        const err = errors[`customFields.${d.key}`];
        const common = { id, name, required: d.required };
        let control: React.ReactNode;
        switch (d.fieldType) {
          case "textarea":
            control = <Textarea {...common} defaultValue={(v as string) ?? ""} rows={2} dir="auto" />;
            break;
          case "number":
            control = <Input {...common} type="number" step="any" defaultValue={(v as number) ?? ""} />;
            break;
          case "date":
            control = <Input {...common} type="date" defaultValue={(v as string) ?? ""} />;
            break;
          case "boolean":
            control = (
              <NativeSelect {...common} defaultValue={v === true ? "true" : v === false ? "false" : ""}>
                <option value="">—</option>
                <option value="true">{t("yes")}</option>
                <option value="false">{t("no")}</option>
              </NativeSelect>
            );
            break;
          case "select":
            control = (
              <NativeSelect {...common} defaultValue={(v as string) ?? ""}>
                <option value="">—</option>
                {d.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </NativeSelect>
            );
            break;
          case "multiselect":
            control = (
              <select {...common} multiple defaultValue={(v as string[]) ?? []} className="min-h-20 w-full rounded-lg border border-input bg-surface p-2 text-sm">
                {d.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            );
            break;
          case "url":
          case "email":
          case "phone":
            control = <Input {...common} type={d.fieldType === "phone" ? "tel" : d.fieldType} dir="ltr" defaultValue={(v as string) ?? ""} />;
            break;
          default:
            control = <Input {...common} defaultValue={(v as string) ?? ""} dir="auto" />;
        }
        return (
          <Field key={d.id} label={d.label} htmlFor={id} error={err} required={d.required}>
            {control}
          </Field>
        );
      })}
    </div>
  );
}

/** Collects `cf.*` fields from a form into a customFields object. */
export function collectCustomFields(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const data = new FormData(form);
  for (const key of new Set([...data.keys()])) {
    if (!key.startsWith("cf.")) continue;
    const all = data.getAll(key).map(String);
    out[key.slice(3)] = all.length > 1 ? all : all[0];
  }
  return out;
}
