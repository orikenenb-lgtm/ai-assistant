"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { LIFECYCLE_STAGES } from "@/modules/crm/schemas";
import { RULE_FIELDS, RULE_OPS, type Rule } from "../definition";

export type BuilderLookups = {
  members: { userId: string; fullName: string }[];
  tags: { id: string; name: string }[];
  stages: { id: string; name: string; pipelineName: string }[];
};

const VALUELESS = new Set(["is_empty", "is_not_empty"]);
const PIPELINE_STAGE_FIELDS = new Set(["deal.stageId", "event.data.toStageId", "event.data.fromStageId"]);
const MEMBER_FIELDS = new Set(["contact.ownerId", "deal.ownerId"]);

export function RuleEditor({ rules, onChange, lookups }: { rules: Rule[]; onChange: (rules: Rule[]) => void; lookups: BuilderLookups }) {
  const t = useTranslations("automation");
  const tc = useTranslations("contacts");
  const update = (i: number, patch: Partial<Rule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rules.map((r, i) => {
        const tagField = r.field === "contact.tags" || r.op === "has_tag" || r.op === "not_has_tag";
        const stageField = r.field === "contact.lifecycleStage" || r.field === "event.data.lifecycleStage";
        const options: { value: string; label: string }[] | null = PIPELINE_STAGE_FIELDS.has(r.field)
          ? lookups.stages.map((s) => ({ value: s.id, label: `${s.pipelineName} · ${s.name}` }))
          : MEMBER_FIELDS.has(r.field)
            ? lookups.members.map((m) => ({ value: m.userId, label: m.fullName }))
            : null;
        return (
          <div key={i} className="space-y-1.5 rounded-lg border border-border p-2">
            <div className="flex gap-1.5">
              <NativeSelect aria-label={t("field")} value={r.field} onChange={(e) => update(i, { field: e.target.value })} className="h-8 text-xs">
                {RULE_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {t(`fields.${f.replaceAll(".", "_")}` as "fields.contact_firstName")}
                  </option>
                ))}
              </NativeSelect>
              <Button type="button" variant="danger-ghost" size="icon-sm" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label={t("removeRule")}>
                <Trash2 />
              </Button>
            </div>
            <NativeSelect aria-label={t("operator")} value={r.op} onChange={(e) => update(i, { op: e.target.value as Rule["op"] })} className="h-8 text-xs">
              {RULE_OPS.map((op) => (
                <option key={op} value={op}>
                  {t(`ops.${op}`)}
                </option>
              ))}
            </NativeSelect>
            {!VALUELESS.has(r.op) &&
              (tagField ? (
                <NativeSelect aria-label={t("value")} value={String(r.value ?? "")} onChange={(e) => update(i, { value: e.target.value })} className="h-8 text-xs">
                  <option value="">—</option>
                  {lookups.tags.map((tg) => (
                    <option key={tg.id} value={tg.id}>
                      {tg.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : options && (r.op === "eq" || r.op === "neq") ? (
                <NativeSelect aria-label={t("value")} value={String(r.value ?? "")} onChange={(e) => update(i, { value: e.target.value })} className="h-8 text-xs">
                  <option value="">—</option>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : stageField ? (
                <NativeSelect aria-label={t("value")} value={String(r.value ?? "")} onChange={(e) => update(i, { value: e.target.value })} className="h-8 text-xs">
                  {LIFECYCLE_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {tc(`stages.${s}`)}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input aria-label={t("value")} value={String(r.value ?? "")} onChange={(e) => update(i, { value: e.target.value })} className="h-8 text-xs" dir="auto" />
              ))}
          </div>
        );
      })}
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rules, { field: "contact.lifecycleStage", op: "eq", value: "customer" }])}>
        <Plus /> {t("addRule")}
      </Button>
    </div>
  );
}
