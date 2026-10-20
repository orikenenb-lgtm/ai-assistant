"use client";

import { createContext, useContext } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Clock, GitBranch, Play, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIFECYCLE_STAGES } from "@/modules/crm/schemas";
import type { ActionType, WorkflowNode } from "../definition";
import type { BuilderLookups } from "./rule-editor";

export type FlowNodeData = { config: WorkflowNode["config"] };
export type FlowNode = Node<FlowNodeData, WorkflowNode["type"]>;

/** Shared builder state the canvas nodes need for their summaries. */
export const BuilderContext = createContext<{ lookups: BuilderLookups; invalid: Set<string>; available: Set<ActionType> }>({
  lookups: { members: [], tags: [], stages: [] },
  invalid: new Set(),
  available: new Set(),
});

const TONES = {
  trigger: "border-primary/50 bg-primary-soft text-primary-soft-foreground",
  condition: "border-warning/50 bg-warning-soft text-warning-foreground",
  action: "border-info/40 bg-info-soft text-info-foreground",
  delay: "border-border bg-muted text-muted-foreground",
} as const;

const ICONS = { trigger: Zap, condition: GitBranch, action: Play, delay: Clock } as const;

function Shell({ id, type, selected, summary, children }: { id: string; type: WorkflowNode["type"]; selected: boolean; summary: string; children?: React.ReactNode }) {
  const t = useTranslations("automation");
  const locale = useLocale();
  const { invalid } = useContext(BuilderContext);
  const Icon = ICONS[type];
  const bad = invalid.has(id);
  return (
    <div
      dir={locale === "he" ? "rtl" : "ltr"}
      className={cn(
        "w-60 rounded-xl border bg-surface shadow-sm transition-shadow",
        selected ? "border-primary ring-2 ring-primary/30" : bad ? "border-danger" : "border-border",
      )}
    >
      <div className={cn("flex items-center gap-2 rounded-t-xl border-b px-3 py-1.5 text-xs font-semibold", TONES[type])}>
        <Icon className="size-3.5" aria-hidden />
        <span>{t(`nodes.${type}`)}</span>
        {bad && <AlertTriangle className="ms-auto size-3.5 text-danger-foreground" aria-label={t("nodeInvalid")} />}
      </div>
      <div className="px-3 py-2">
        <p className="line-clamp-2 break-words text-[13px] leading-snug text-foreground">{summary}</p>
      </div>
      {children}
    </div>
  );
}

const handleCls = "!size-2.5 !border-2 !border-surface !bg-muted-foreground";

export function TriggerNode({ id, data, selected }: NodeProps<FlowNode>) {
  const t = useTranslations("automation");
  const c = data.config as Extract<WorkflowNode, { type: "trigger" }>["config"];
  const summary =
    c.kind === "event"
      ? t(`events.${c.event.replaceAll(".", "_")}` as "events.contact_created")
      : c.kind === "schedule"
        ? `${t(`frequencies.${c.frequency}`)}${c.frequency === "hourly" ? "" : ` · ${String(c.hour).padStart(2, "0")}:00`}${c.frequency === "weekly" ? ` · ${t(`weekdays.${c.weekday}` as "weekdays.0")}` : ""}`
        : t(`triggerKinds.${c.kind}`);
  return (
    <Shell id={id} type="trigger" selected={selected} summary={summary}>
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </Shell>
  );
}

/** Human label for a rule value (stage names, tag names, members) shown on the canvas. */
function useValueLabel() {
  const tc = useTranslations("contacts");
  const { lookups } = useContext(BuilderContext);
  return (field: string, value: unknown): string => {
    if (value === undefined || value === null || value === "") return "";
    const v = String(value);
    if (field.endsWith("lifecycleStage") && (LIFECYCLE_STAGES as readonly string[]).includes(v)) return tc(`stages.${v as (typeof LIFECYCLE_STAGES)[number]}`);
    return (
      lookups.tags.find((x) => x.id === v)?.name ??
      lookups.stages.find((x) => x.id === v)?.name ??
      lookups.members.find((x) => x.userId === v)?.fullName ??
      (Array.isArray(value) ? value.join(", ") : v)
    );
  };
}

export function ConditionNode({ id, data, selected }: NodeProps<FlowNode>) {
  const t = useTranslations("automation");
  const valueLabel = useValueLabel();
  const c = data.config as Extract<WorkflowNode, { type: "condition" }>["config"];
  const first = c.rules[0];
  const summary = first
    ? `${t(`fields.${first.field.replaceAll(".", "_")}` as "fields.contact_firstName")} ${t(`ops.${first.op}`)} ${valueLabel(first.field, first.value)}`.trim() +
      (c.rules.length > 1 ? ` (+${c.rules.length - 1})` : "")
    : t("nodes.condition");
  return (
    <Shell id={id} type="condition" selected={selected} summary={summary}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      <div className="flex justify-between px-3 pb-1.5 text-[11px] font-medium" dir="ltr">
        <span className="text-success-foreground">{t("branchTrue")}</span>
        <span className="text-danger-foreground">{t("branchFalse")}</span>
      </div>
      <Handle type="source" id="true" position={Position.Bottom} style={{ left: "25%" }} className={cn(handleCls, "!bg-success")} />
      <Handle type="source" id="false" position={Position.Bottom} style={{ left: "75%" }} className={cn(handleCls, "!bg-danger")} />
    </Shell>
  );
}

export function ActionNode({ id, data, selected }: NodeProps<FlowNode>) {
  const t = useTranslations("automation");
  const { available, lookups } = useContext(BuilderContext);
  const c = data.config as Extract<WorkflowNode, { type: "action" }>["config"];
  const p = c.params as Record<string, unknown>;
  const detail =
    c.action === "add_tag" || c.action === "remove_tag"
      ? lookups.tags.find((x) => x.id === p.tagId)?.name
      : c.action === "move_deal_stage"
        ? lookups.stages.find((x) => x.id === p.stageId)?.name
        : typeof p.title === "string"
          ? p.title
          : typeof p.templateName === "string"
            ? p.templateName
            : undefined;
  const summary = `${t(`actions.${c.action}`)}${detail ? `: ${detail}` : ""}`;
  return (
    <Shell id={id} type="action" selected={selected} summary={summary}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      {!available.has(c.action) && <p className="px-3 pb-2 text-[11px] text-warning-foreground">{t("actionUnavailableShort")}</p>}
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </Shell>
  );
}

export function DelayNode({ id, data, selected }: NodeProps<FlowNode>) {
  const t = useTranslations("automation");
  const c = data.config as Extract<WorkflowNode, { type: "delay" }>["config"];
  return (
    <Shell id={id} type="delay" selected={selected} summary={t("delaySummary", { amount: c.amount, unit: t(`units.${c.unit}`) })}>
      <Handle type="target" position={Position.Top} className={handleCls} />
      <Handle type="source" position={Position.Bottom} className={handleCls} />
    </Shell>
  );
}

export const NODE_TYPES = { trigger: TriggerNode, condition: ConditionNode, action: ActionNode, delay: DelayNode };
