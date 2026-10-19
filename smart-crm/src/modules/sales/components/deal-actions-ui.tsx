"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { RotateCcw, Trophy, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, NativeSelect, Textarea } from "@/components/ui/input";
import type { TagOption } from "@/components/data/tag-picker";
import { useServerAction } from "@/hooks/use-server-action";
import { cn } from "@/lib/utils";
import { deleteDealAction, loseDealAction, moveDealAction, reopenDealAction, setDealTagsAction, winDealAction } from "../deal-actions";
import { DeleteEntityButton, TagsEditor } from "./shared";

export type LostReasonOption = { id: string; label: string };

/** Controlled "why was it lost?" dialog shared by the board and the deal page. */
export function LostDealDialog({
  dealId,
  open,
  onOpenChange,
  reasons,
  onDone,
}: {
  dealId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reasons: LostReasonOption[];
  onDone?: () => void;
}) {
  const t = useTranslations("deals");
  const tc = useTranslations("common");
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const { run, pending } = useServerAction(loseDealAction, { successMessage: t("lostToast") });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("lostTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("lostReason")} htmlFor="lostReasonId">
            <NativeSelect id="lostReasonId" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
              <option value="">{t("noReason")}</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("lostNote")} htmlFor="lostNote">
            <Textarea id="lostNote" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} dir="auto" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            variant="danger"
            loading={pending}
            disabled={!dealId}
            onClick={async () => {
              if (!dealId) return;
              const res = await run({ id: dealId, lostReasonId: reasonId || null, lostNote: note || null });
              if (res.ok) {
                onOpenChange(false);
                setReasonId("");
                setNote("");
                onDone?.();
              }
            }}
          >
            {t("markLost")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DealStatusButtons({ dealId, status, reasons }: { dealId: string; status: "open" | "won" | "lost"; reasons: LostReasonOption[] }) {
  const t = useTranslations("deals");
  const router = useRouter();
  const [lostOpen, setLostOpen] = useState(false);
  const win = useServerAction(winDealAction, { successMessage: t("wonToast") });
  const reopen = useServerAction(reopenDealAction, { successMessage: t("reopenedToast") });
  return (
    <>
      {status === "open" ? (
        <>
          <Button
            size="sm"
            className="bg-success text-white hover:bg-success/90"
            loading={win.pending}
            onClick={async () => {
              const res = await win.run({ id: dealId });
              if (res.ok) router.refresh();
            }}
          >
            <Trophy /> {t("markWon")}
          </Button>
          <Button size="sm" variant="danger-ghost" onClick={() => setLostOpen(true)}>
            <XCircle /> {t("markLost")}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          loading={reopen.pending}
          onClick={async () => {
            const res = await reopen.run({ id: dealId });
            if (res.ok) router.refresh();
          }}
        >
          <RotateCcw /> {t("reopen")}
        </Button>
      )}
      <LostDealDialog dealId={dealId} open={lostOpen} onOpenChange={setLostOpen} reasons={reasons} onDone={() => router.refresh()} />
    </>
  );
}

type ProgressStage = { id: string; name: string; kind: "open" | "won" | "lost"; color: string; probability: number };

/**
 * Stage progress bar for the deal page. Open stages are buttons (when editable) that move the deal;
 * won/lost are reached through the status buttons so a lost reason is always captured.
 */
export function DealStageProgress({
  dealId,
  stages,
  currentStageId,
  status,
  canEdit,
}: {
  dealId: string;
  stages: ProgressStage[];
  currentStageId: string;
  status: "open" | "won" | "lost";
  canEdit: boolean;
}) {
  const t = useTranslations("deals");
  const router = useRouter();
  const move = useServerAction(moveDealAction);
  const open = stages.filter((s) => s.kind === "open");
  const currentIndex = open.findIndex((s) => s.id === currentStageId);
  const closed = stages.find((s) => s.id === currentStageId && s.kind !== "open");
  return (
    <div>
      <ol className="flex gap-1" aria-label={t("stageProgress")}>
        {open.map((s, i) => {
          const reached = status === "won" || (status === "open" && i <= currentIndex);
          const current = s.id === currentStageId;
          const content = (
            <>
              <span
                className={cn("block h-2 rounded-full transition-colors", reached ? "" : "bg-muted", status === "lost" && "bg-muted")}
                style={reached ? { backgroundColor: status === "won" ? "var(--color-success)" : s.color } : undefined}
                aria-hidden
              />
              <span className={cn("mt-1.5 block truncate text-xs", current ? "font-semibold text-foreground" : "text-muted-foreground")}>{s.name}</span>
            </>
          );
          return (
            <li key={s.id} className="min-w-0 flex-1" aria-current={current ? "step" : undefined}>
              {canEdit && status === "open" && !current ? (
                <button
                  type="button"
                  className="block w-full rounded-md text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
                  disabled={move.pending}
                  title={s.name}
                  onClick={async () => {
                    const res = await move.run({ id: dealId, stageId: s.id });
                    if (res.ok) {
                      toast.success(t("movedToast", { stage: s.name }));
                      router.refresh();
                    }
                  }}
                >
                  {content}
                </button>
              ) : (
                <div title={s.name}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
      {closed && (
        <p className={cn("mt-2 text-sm font-medium", closed.kind === "won" ? "text-success-foreground" : "text-danger-foreground")}>{closed.name}</p>
      )}
    </div>
  );
}

export function DealDeleteButton({ dealId, name }: { dealId: string; name: string }) {
  const t = useTranslations("deals");
  return <DeleteEntityButton description={t("deleteConfirm", { name })} action={() => deleteDealAction({ id: dealId })} redirectTo="/deals" />;
}

export function DealTagsEditor({ dealId, allTags, initial, canEdit }: { dealId: string; allTags: TagOption[]; initial: string[]; canEdit: boolean }) {
  return <TagsEditor allTags={allTags} initial={initial} canEdit={canEdit} save={(tagIds) => setDealTagsAction({ dealId, tagIds })} />;
}
