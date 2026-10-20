"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { NativeSelect } from "@/components/ui/input";
import { AsyncCombobox, type ComboOption } from "@/components/data/async-combobox";
import { searchCompaniesAction, searchContactsAction, searchDealsAction, searchLeadsAction } from "@/modules/crm/lookup-actions";

export type LinkKind = "contact" | "company" | "deal" | "lead";
export type LinkValue = { kind: LinkKind; option: ComboOption } | null;

const SEARCH = {
  contact: searchContactsAction,
  company: searchCompaniesAction,
  deal: searchDealsAction,
  lead: searchLeadsAction,
};

/** Picks one related CRM record: type selector + searchable record selector. */
export function LinkPicker({
  id,
  value,
  onChange,
  kinds = ["contact", "company", "deal", "lead"],
}: {
  id: string;
  value: LinkValue;
  onChange: (v: LinkValue) => void;
  kinds?: LinkKind[];
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [kind, setKind] = useState<LinkKind | "">(value?.kind ?? "");
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
      <NativeSelect
        id={id}
        aria-label={t("fields.link")}
        value={kind}
        onChange={(e) => {
          const next = e.target.value as LinkKind | "";
          setKind(next);
          onChange(null);
        }}
      >
        <option value="">{tc("none")}</option>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {t(`fields.${k}`)}
          </option>
        ))}
      </NativeSelect>
      {kind && (
        <AsyncCombobox
          id={`${id}-record`}
          value={value?.kind === kind ? value.option : null}
          onChange={(option) => onChange(option ? { kind, option } : null)}
          search={SEARCH[kind]}
          placeholder={t(`fields.${kind}`)}
        />
      )}
    </div>
  );
}
