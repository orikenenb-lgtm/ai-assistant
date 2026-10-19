"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";
import { TD, TR } from "@/components/ui/table";
import { useServerAction } from "@/hooks/use-server-action";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelRunAction, retryRunAction, runStepsAction } from "../actions";

export type RunView = {
  id: string;
  status: string;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  stepsExecuted: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  workflowVersion: number;
};

type Step = { id: number; nodeId: string; nodeType: string; status: string; attempt: number; error: string | null; output: unknown; startedAt: Date | string; finishedAt: Date | string | null };

export const RUN_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  pending: "neutral",
  running: "info",
  waiting: "warning",
  completed: "success",
  failed: "danger",
  canceled: "neutral",
  skipped: "neutral",
};

const ENTITY_HREF: Record<string, string> = { contact: "/contacts", deal: "/deals", lead: "/leads" };

export function RunRow({ run, canManage, timeZone }: { run: RunView; canManage: boolean; timeZone: string }) {
  const t = useTranslations("automation");
  const locale = useLocale() as "he" | "en";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const load = useServerAction(runStepsAction, { onSuccess: (rows) => setSteps(rows as Step[]) });
  const retry = useServerAction(retryRunAction, { onSuccess: () => router.refresh(), successMessage: t("retryQueued") });
  const cancel = useServerAction(cancelRunAction, { onSuccess: () => router.refresh() });

  const toggle = () => {
    setOpen((o) => !o);
    if (!steps && !load.pending) load.run({ id: run.id });
  };
  const href = run.entityType && run.entityId && ENTITY_HREF[run.entityType] ? `${ENTITY_HREF[run.entityType]}/${run.entityId}` : null;

  return (
    <Fragment>
      <TR>
        <TD>
          <button type="button" onClick={toggle} aria-expanded={open} className="inline-flex items-center gap-1.5 text-sm hover:underline">
            <ChevronDown className={cn("size-4 transition-transform", !open && "ltr:-rotate-90 rtl:rotate-90")} aria-hidden />
            {formatDateTime(run.startedAt, locale, timeZone)}
          </button>
        </TD>
        <TD>
          <Badge tone={RUN_TONE[run.status] ?? "neutral"}>{t(`runStatus.${run.status}` as "runStatus.pending")}</Badge>
        </TD>
        <TD className="text-sm">
          {href ? (
            <Link href={href} className="hover:underline">
              {run.entityName ?? run.entityType}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TD>
        <TD className="tabular text-end text-sm">{run.stepsExecuted}</TD>
        <TD className="max-w-xs truncate text-xs text-danger-foreground" title={run.error ?? undefined}>
          {run.error}
        </TD>
        <TD className="text-end">
          {canManage && run.status === "failed" && (
            <Button size="sm" variant="ghost" loading={retry.pending} onClick={() => retry.run({ id: run.id })}>
              <RotateCcw /> {t("retry")}
            </Button>
          )}
          {canManage && ["pending", "running", "waiting"].includes(run.status) && (
            <Button size="sm" variant="danger-ghost" loading={cancel.pending} onClick={() => cancel.run({ id: run.id })}>
              <XCircle /> {t("cancel")}
            </Button>
          )}
        </TD>
      </TR>
      {open && (
        <TR>
          <TD colSpan={6} className="bg-muted/40">
            {load.pending && !steps ? (
              <Spinner className="mx-auto my-3 size-5" />
            ) : steps && steps.length ? (
              <ol className="space-y-1.5 py-1" aria-label={t("stepLog")}>
                {steps.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={RUN_TONE[s.status] ?? "neutral"}>{t(`runStatus.${s.status}` as "runStatus.pending")}</Badge>
                    <span className="font-medium">{t(`nodes.${s.nodeType}` as "nodes.action")}</span>
                    <code dir="ltr" className="text-muted-foreground">
                      {s.nodeId}
                    </code>
                    {s.attempt > 1 && <span className="text-muted-foreground">{t("attempt", { n: s.attempt })}</span>}
                    <span className="text-muted-foreground">{formatDateTime(s.startedAt, locale, timeZone)}</span>
                    {s.error && <span className="text-danger-foreground">{s.error}</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-2 text-xs text-muted-foreground">{t("noSteps")}</p>
            )}
          </TD>
        </TR>
      )}
    </Fragment>
  );
}
