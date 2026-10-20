"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, TagPill } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { ConfirmDialog } from "@/components/data/confirm-dialog";
import { AttachmentsPanel, LogActivityDialog, NotesPanel, TimelinePanel, type EntityKind } from "@/components/data/entity-panels";
import { TagPicker, type TagOption } from "@/components/data/tag-picker";
import type { ActionResult } from "@/server/action";

/** Delete button with confirmation that redirects to `redirectTo` afterwards. */
export function DeleteEntityButton({
  description,
  action,
  redirectTo,
}: {
  description: string;
  action: () => Promise<ActionResult>;
  redirectTo: string;
}) {
  const tc = useTranslations("common");
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="danger-ghost" size="icon-sm" aria-label={tc("delete")}>
          <Trash2 />
        </Button>
      }
      description={description}
      onConfirm={async () => {
        const res = await action();
        if (!res.ok) return void toast.error(res.error.message);
        toast.success(tc("deleted"));
        router.push(redirectTo);
      }}
    />
  );
}

/** Tag editor that saves immediately (optimistic with rollback). */
export function TagsEditor({
  allTags,
  initial,
  canEdit,
  save,
}: {
  allTags: TagOption[];
  initial: string[];
  canEdit: boolean;
  save: (tagIds: string[]) => Promise<ActionResult>;
}) {
  const [tags, setTags] = useState(allTags);
  const [value, setValue] = useState(initial);
  if (!canEdit) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {allTags
          .filter((t) => initial.includes(t.id))
          .map((t) => (
            <TagPill key={t.id} name={t.name} color={t.color} />
          ))}
      </div>
    );
  }
  return (
    <TagPicker
      allTags={tags}
      value={value}
      onChange={async (ids, created) => {
        if (created) setTags((p) => [...p, created]);
        const prev = value;
        setValue(ids);
        const res = await save(ids);
        if (!res.ok) {
          setValue(prev);
          toast.error(res.error.message);
        }
      }}
    />
  );
}

export type ExtraTab = { value: string; label: React.ReactNode; content: React.ReactNode };

/** Timeline / notes / files tabs shared by all CRM record pages, plus optional extra tabs. */
export function RecordTabs({
  kind,
  entityId,
  currentUserId,
  canEdit,
  canModerate,
  extraTabs = [],
}: {
  kind: EntityKind;
  entityId: string;
  currentUserId: string;
  canEdit: boolean;
  canModerate: boolean;
  extraTabs?: ExtraTab[];
}) {
  const t = useTranslations("crm");
  const [refresh, setRefresh] = useState(0);
  const bump = () => setRefresh((n) => n + 1);
  return (
    <Card className="p-4 sm:p-5">
      <Tabs defaultValue="timeline">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="timeline">{t("tabs.timeline")}</TabsTrigger>
            <TabsTrigger value="notes">{t("tabs.notes")}</TabsTrigger>
            {extraTabs.map((x) => (
              <TabsTrigger key={x.value} value={x.value}>
                {x.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="files">{t("tabs.files")}</TabsTrigger>
          </TabsList>
          {canEdit && <LogActivityDialog kind={kind} entityId={entityId} onLogged={bump} />}
        </div>
        <TabsContent value="timeline">
          <TimelinePanel kind={kind} entityId={entityId} refreshKey={refresh} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesPanel kind={kind} entityId={entityId} currentUserId={currentUserId} canModerate={canModerate} onChange={bump} />
        </TabsContent>
        {extraTabs.map((x) => (
          <TabsContent key={x.value} value={x.value}>
            {x.content}
          </TabsContent>
        ))}
        <TabsContent value="files">
          <AttachmentsPanel kind={kind} entityId={entityId} canEdit={canEdit} onChange={bump} />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

/** Label/value row used in the details cards. */
export function DetailRow({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="flex shrink-0 items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 text-end font-medium" dir="auto">
        {children}
      </dd>
    </div>
  );
}

/** Renders a stored custom field value for display. */
export function formatCustomValue(v: unknown, yes: string, no: string): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? yes : no;
  return String(v);
}
