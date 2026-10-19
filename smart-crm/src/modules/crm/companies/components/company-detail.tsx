"use client";

import { useTranslations } from "next-intl";
import type { TagOption } from "@/components/data/tag-picker";
import { DeleteEntityButton, TagsEditor } from "@/modules/sales/components/shared";
import { deleteCompanyAction, setCompanyTagsAction } from "../actions";

export function CompanyDeleteButton({ companyId, name }: { companyId: string; name: string }) {
  const t = useTranslations("companies");
  return <DeleteEntityButton description={t("deleteConfirm", { name })} action={() => deleteCompanyAction({ id: companyId })} redirectTo="/companies" />;
}

export function CompanyTagsEditor({ companyId, allTags, initial, canEdit }: { companyId: string; allTags: TagOption[]; initial: string[]; canEdit: boolean }) {
  return <TagsEditor allTags={allTags} initial={initial} canEdit={canEdit} save={(tagIds) => setCompanyTagsAction({ companyId, tagIds })} />;
}
