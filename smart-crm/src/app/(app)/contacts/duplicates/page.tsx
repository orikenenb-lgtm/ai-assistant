import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CopyCheck } from "lucide-react";
import { requireTenant } from "@/server/tenancy";
import { listDuplicateGroups } from "@/modules/crm/contacts/service";
import { MergeGroup } from "@/modules/crm/components/merge-group";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export async function generateMetadata() {
  return { title: (await getTranslations("contacts"))("duplicates") };
}

export default async function DuplicatesPage() {
  const { ctx } = await requireTenant();
  if (!ctx.can("contacts.merge")) redirect("/contacts");
  const t = await getTranslations("contacts");
  const locale = (await getLocale()) as "he" | "en";
  const groups = await listDuplicateGroups(ctx);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("duplicates")} description={t("duplicatesSubtitle")} />
      {groups.length === 0 ? (
        <EmptyState icon={<CopyCheck />} title={t("noDuplicates")} />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <MergeGroup
              key={g.key}
              matchedOn={g.matchedOn}
              readOnly={ctx.readOnly}
              contacts={g.contacts.map((c) => ({ id: c.id, name: c.name, detail: [c.email, formatPhone(c.phone)].filter(Boolean).join(" · "), created: formatDate(c.createdAt, locale) }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
