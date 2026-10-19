"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { GitMerge } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { mergeContactsAction } from "../contacts/actions";

type C = { id: string; name: string; detail: string; created: string };

export function MergeGroup({ contacts, matchedOn, readOnly }: { contacts: C[]; matchedOn: "email" | "phone"; readOnly: boolean }) {
  const t = useTranslations("contacts");
  const router = useRouter();
  const [primary, setPrimary] = useState(contacts[0].id);
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Badge tone="warning">{t(`matchedOn.${matchedOn}`)}</Badge>
        <span className="text-sm text-muted-foreground">{t("choosePrimary")}</span>
      </div>
      <fieldset className="space-y-2">
        <legend className="sr-only">{t("choosePrimary")}</legend>
        {contacts.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40">
            <input type="radio" name={`primary-${contacts[0].id}`} checked={primary === c.id} onChange={() => setPrimary(c.id)} className="accent-[var(--primary)]" />
            <span className="flex-1">
              <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                {c.name}
              </Link>
              <span className="block text-xs text-muted-foreground" dir="auto">
                {c.detail} · {c.created}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {!readOnly && (
        <div className="mt-4 flex justify-end">
          <ConfirmDialog
            tone="primary"
            title={t("mergeTitle")}
            description={t("mergeBody", { count: contacts.length - 1 })}
            confirmLabel={t("merge")}
            trigger={
              <Button size="sm">
                <GitMerge /> {t("merge")}
              </Button>
            }
            onConfirm={async () => {
              for (const c of contacts) {
                if (c.id === primary) continue;
                const res = await mergeContactsAction({ primaryId: primary, duplicateId: c.id });
                if (!res.ok) return void toast.error(res.error.message);
              }
              toast.success(t("merged"));
              router.refresh();
            }}
          />
        </div>
      )}
    </Card>
  );
}
