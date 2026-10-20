"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Archive, ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Checkbox, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { Badge, EmptyState, TagPill } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { formToObject, useServerAction } from "@/hooks/use-server-action";
import type { CustomFieldDef, CustomFieldEntity, CustomFieldType } from "@/modules/crm/custom-fields";
import {
  archiveCustomFieldAction,
  createCustomFieldAction,
  createTagSettingsAction,
  deleteTagAction,
  reorderCustomFieldsAction,
  updateCustomFieldAction,
  updateTagAction,
} from "../settings-actions";

const ENTITIES: CustomFieldEntity[] = ["contact", "company", "deal", "lead"];
// Mirrors CUSTOM_FIELD_TYPES / TAG_COLORS (server modules can't be imported into client code).
const FIELD_TYPES: CustomFieldType[] = ["text", "textarea", "number", "date", "boolean", "select", "multiselect", "url", "email", "phone"];
const TAG_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"];
const hasOptions = (type: string) => type === "select" || type === "multiselect";
const parseOptions = (text: string) =>
  text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

/* --------------------------------------------------------- custom fields */

export function CustomFieldsManager({ fields, canEdit }: { fields: Record<CustomFieldEntity, CustomFieldDef[]>; canEdit: boolean }) {
  const t = useTranslations("crmSettings");
  return (
    <Tabs defaultValue="contact">
      <TabsList className="max-w-full overflow-x-auto">
        {ENTITIES.map((e) => (
          <TabsTrigger key={e} value={e}>
            {t(`entities.${e}`)}
            <span className="tabular text-xs text-muted-foreground">{fields[e].length}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {ENTITIES.map((e) => (
        <TabsContent key={e} value={e} className="space-y-4">
          {canEdit && (
            <div className="flex justify-end">
              <FieldDialog entity={e} />
            </div>
          )}
          {fields[e].length === 0 ? (
            <EmptyState title={t("noFields")} />
          ) : (
            <FieldList entity={e} fields={fields[e]} canEdit={canEdit} />
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function FieldList({ entity, fields, canEdit }: { entity: CustomFieldEntity; fields: CustomFieldDef[]; canEdit: boolean }) {
  const t = useTranslations("crmSettings");
  const tc = useTranslations("common");
  const router = useRouter();
  const reorder = useServerAction(reorderCustomFieldsAction);
  const move = async (index: number, delta: -1 | 1) => {
    const ids = fields.map((f) => f.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const res = await reorder.run({ entityType: entity, orderedIds: ids });
    if (res.ok) router.refresh();
  };
  return (
    <ol className="divide-y divide-border rounded-lg border border-border bg-surface">
      {fields.map((f, i) => (
        <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-testid="custom-field-row">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <span dir="auto">{f.label}</span>
              {f.required && <Badge tone="warning">{t("required")}</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(`types.${f.fieldType}`)} ·{" "}
              <code dir="ltr" className="font-mono">
                {f.key}
              </code>
              {hasOptions(f.fieldType) && f.options.length > 0 && <> · {f.options.join(", ")}</>}
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon-sm" aria-label={t("moveUp", { name: f.label })} disabled={i === 0 || reorder.pending} onClick={() => move(i, -1)}>
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("moveDown", { name: f.label })}
                disabled={i === fields.length - 1 || reorder.pending}
                onClick={() => move(i, 1)}
              >
                <ArrowDown />
              </Button>
              <FieldDialog entity={entity} field={f} />
              <ConfirmDialog
                trigger={
                  <Button variant="danger-ghost" size="icon-sm" aria-label={`${t("archive")} ${f.label}`}>
                    <Archive />
                  </Button>
                }
                title={t("archive")}
                description={t("archiveConfirm", { name: f.label })}
                confirmLabel={t("archive")}
                onConfirm={async () => {
                  const res = await archiveCustomFieldAction({ id: f.id });
                  if (!res.ok) return void toast.error(res.error.message);
                  toast.success(tc("saved"));
                  router.refresh();
                }}
              />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Create (no `field`) or edit a custom field. Key and type are fixed after creation (stored values depend on them). */
function FieldDialog({ entity, field }: { entity: CustomFieldEntity; field?: CustomFieldDef }) {
  const t = useTranslations("crmSettings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CustomFieldType>(field?.fieldType ?? "text");
  const [required, setRequired] = useState(field?.required ?? false);
  const create = useServerAction(createCustomFieldAction, { successMessage: tc("saved") });
  const update = useServerAction(updateCustomFieldAction, { successMessage: tc("saved") });
  const action = field ? update : create;
  const idp = field ? `cf-${field.id}` : `cf-new-${entity}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {field ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("editField", { name: field.label })}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> {t("newField")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{field ? t("editField", { name: field.label }) : `${t("newField")} · ${t(`entities.${entity}`)}`}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = formToObject(e.currentTarget);
            const options = hasOptions(type) ? parseOptions(d.options ?? "") : [];
            const res = field
              ? await update.run({ id: field.id, label: d.label, required, ...(hasOptions(type) ? { options } : {}) })
              : await create.run({ entityType: entity, label: d.label, key: d.key || undefined, fieldType: type, options, required });
            if (res.ok) {
              setOpen(false);
              router.refresh();
            }
          }}
        >
          <Field label={t("label")} htmlFor={`${idp}-label`} error={action.fieldErrors.label} required>
            <Input id={`${idp}-label`} name="label" defaultValue={field?.label} required maxLength={80} autoFocus dir="auto" />
          </Field>
          {!field && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("type")} htmlFor={`${idp}-type`} error={action.fieldErrors.fieldType}>
                <NativeSelect id={`${idp}-type`} value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
                  {FIELD_TYPES.map((ft) => (
                    <option key={ft} value={ft}>
                      {t(`types.${ft}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t("key")} htmlFor={`${idp}-key`} error={action.fieldErrors.key} hint={t("keyHint")}>
                <Input id={`${idp}-key`} name="key" dir="ltr" maxLength={40} pattern="[a-z][a-z0-9_]*" placeholder="e.g. vat_number" />
              </Field>
            </div>
          )}
          {hasOptions(type) && (
            <Field label={t("options")} htmlFor={`${idp}-options`} error={action.fieldErrors.options} hint={t("optionsHint")}>
              <Textarea id={`${idp}-options`} name="options" rows={4} defaultValue={field?.options.join("\n")} dir="auto" />
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={required} onCheckedChange={(v) => setRequired(v === true)} />
            {t("required")}
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={action.pending}>
              {field ? tc("save") : tc("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ tags */

export type TagUsageItem = { id: string; name: string; color: string; usage: number };

export function TagsManager({ tags, canEdit }: { tags: TagUsageItem[]; canEdit: boolean }) {
  const t = useTranslations("crmSettings");
  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <TagDialog />
        </div>
      )}
      {tags.length === 0 ? (
        <EmptyState title={t("noTags")} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {tags.map((tag) => (
            <TagRow key={tag.id} tag={tag} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TagRow({ tag, canEdit }: { tag: TagUsageItem; canEdit: boolean }) {
  const t = useTranslations("crmSettings");
  const tc = useTranslations("common");
  const router = useRouter();
  return (
    <li className="flex items-center gap-3 px-3 py-2.5" data-testid="tag-row">
      <div className="min-w-0 flex-1">
        <TagPill name={tag.name} color={tag.color} />
      </div>
      <span className="text-sm text-muted-foreground">{t("usage", { count: tag.usage })}</span>
      {canEdit && (
        <div className="flex items-center gap-0.5">
          <TagDialog tag={tag} />
          <ConfirmDialog
            trigger={
              <Button variant="danger-ghost" size="icon-sm" aria-label={t("deleteTag", { name: tag.name })}>
                <Trash2 />
              </Button>
            }
            description={t("deleteTagConfirm", { name: tag.name })}
            onConfirm={async () => {
              const res = await deleteTagAction({ id: tag.id });
              if (!res.ok) return void toast.error(res.error.message);
              toast.success(tc("deleted"));
              router.refresh();
            }}
          />
        </div>
      )}
    </li>
  );
}

function TagDialog({ tag }: { tag?: TagUsageItem }) {
  const t = useTranslations("crmSettings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(tag?.color ?? TAG_COLORS[0]);
  const create = useServerAction(createTagSettingsAction, { successMessage: tc("saved") });
  const update = useServerAction(updateTagAction, { successMessage: tc("saved") });
  const action = tag ? update : create;
  const idp = tag ? `tag-${tag.id}` : "tag-new";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {tag ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("editTag", { name: tag.name })}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> {t("newTag")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{tag ? t("editTag", { name: tag.name }) : t("newTag")}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const d = formToObject(e.currentTarget);
            const res = tag ? await update.run({ id: tag.id, name: d.name, color }) : await create.run({ name: d.name, color });
            if (res.ok) {
              setOpen(false);
              router.refresh();
            }
          }}
        >
          <Field label={t("tagName")} htmlFor={`${idp}-name`} error={action.fieldErrors.name} required>
            <Input id={`${idp}-name`} name="name" defaultValue={tag?.name} required maxLength={40} autoFocus dir="auto" />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t("color")}</legend>
            <div className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="size-7 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  style={{ backgroundColor: c, borderColor: color === c ? "var(--color-foreground)" : "transparent" }}
                  aria-label={c}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={action.pending}>
              {tag ? tc("save") : tc("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
