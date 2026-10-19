"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, RefreshCw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/primitives";
import { DOMAIN_EVENTS } from "@/lib/domain-events";
import { LIFECYCLE_STAGES } from "@/modules/crm/schemas";
import { useServerAction } from "@/hooks/use-server-action";
import { ACTION_PARAMS, DEFAULT_PARAMS } from "../action-params";
import { ACTION_TYPES, type ActionType, type Rule, type WorkflowNode } from "../definition";
import { previewSegmentAction } from "../actions";
import { RuleEditor, type BuilderLookups } from "./rule-editor";

type Props = {
  node: WorkflowNode;
  onChange: (config: WorkflowNode["config"]) => void;
  onDelete: () => void;
  lookups: BuilderLookups;
  available: Set<ActionType>;
  disabled: boolean;
  webhook: { hasToken: boolean; url: string | null; onRotate: () => void; rotating: boolean; published: boolean };
};

export function NodeConfig({ node, onChange, onDelete, lookups, available, disabled, webhook }: Props) {
  const t = useTranslations("automation");
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="sr-only">{t(`nodes.${node.type}`)}</legend>
      {node.type === "trigger" && <TriggerConfig config={node.config} onChange={onChange} lookups={lookups} webhook={webhook} />}
      {node.type === "condition" && (
        <>
          <Field label={t("match")} htmlFor="cond-match">
            <NativeSelect id="cond-match" value={node.config.match} onChange={(e) => onChange({ ...node.config, match: e.target.value as "all" | "any" })}>
              <option value="all">{t("matchAll")}</option>
              <option value="any">{t("matchAny")}</option>
            </NativeSelect>
          </Field>
          <RuleEditor rules={node.config.rules} onChange={(rules) => onChange({ ...node.config, rules })} lookups={lookups} />
          {node.config.rules.length === 0 && <p className="text-xs text-danger-foreground">{t("conditionNeedsRule")}</p>}
        </>
      )}
      {node.type === "action" && <ActionConfig config={node.config} onChange={onChange} lookups={lookups} available={available} />}
      {node.type === "delay" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("amount")} htmlFor="delay-amount">
            <Input
              id="delay-amount"
              type="number"
              min={1}
              max={365}
              value={node.config.amount}
              onChange={(e) => onChange({ ...node.config, amount: clampInt(e.target.value, 1, 365) })}
            />
          </Field>
          <Field label={t("unit")} htmlFor="delay-unit">
            <NativeSelect id="delay-unit" value={node.config.unit} onChange={(e) => onChange({ ...node.config, unit: e.target.value as "minutes" | "hours" | "days" })}>
              {(["minutes", "hours", "days"] as const).map((u) => (
                <option key={u} value={u}>
                  {t(`units.${u}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      )}
      {node.type !== "trigger" && (
        <Button type="button" variant="danger-ghost" size="sm" onClick={onDelete}>
          <Trash2 /> {t("deleteNode")}
        </Button>
      )}
    </fieldset>
  );
}

function clampInt(v: string, min: number, max: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

type TriggerCfg = Extract<WorkflowNode, { type: "trigger" }>["config"];

function TriggerConfig({ config, onChange, lookups, webhook }: { config: TriggerCfg; onChange: (c: TriggerCfg) => void; lookups: BuilderLookups; webhook: Props["webhook"] }) {
  const t = useTranslations("automation");
  const setKind = (kind: TriggerCfg["kind"]) => {
    if (kind === config.kind) return;
    if (kind === "event") onChange({ kind, event: "contact.created", filters: [] });
    else if (kind === "schedule") onChange({ kind, frequency: "daily", hour: 9, weekday: 0, segment: [] });
    else onChange({ kind });
  };
  return (
    <>
      <Field label={t("kind")} htmlFor="trigger-kind">
        <NativeSelect id="trigger-kind" value={config.kind} onChange={(e) => setKind(e.target.value as TriggerCfg["kind"])}>
          {(["event", "schedule", "webhook", "manual"] as const).map((k) => (
            <option key={k} value={k}>
              {t(`triggerKinds.${k}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {config.kind === "event" && (
        <>
          <Field label={t("event")} htmlFor="trigger-event">
            <NativeSelect id="trigger-event" value={config.event} onChange={(e) => onChange({ ...config, event: e.target.value as typeof config.event })}>
              {DOMAIN_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {t(`events.${ev.replaceAll(".", "_")}` as "events.contact_created")}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t("filters")}</p>
            <RuleEditor rules={config.filters} onChange={(filters) => onChange({ ...config, filters })} lookups={lookups} />
          </div>
        </>
      )}
      {config.kind === "schedule" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("frequency")} htmlFor="sch-freq">
              <NativeSelect id="sch-freq" value={config.frequency} onChange={(e) => onChange({ ...config, frequency: e.target.value as typeof config.frequency })}>
                {(["hourly", "daily", "weekly"] as const).map((f) => (
                  <option key={f} value={f}>
                    {t(`frequencies.${f}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {config.frequency !== "hourly" && (
              <Field label={t("hour")} htmlFor="sch-hour">
                <NativeSelect id="sch-hour" value={config.hour} onChange={(e) => onChange({ ...config, hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {config.frequency === "weekly" && (
              <Field label={t("weekday")} htmlFor="sch-day">
                <NativeSelect id="sch-day" value={config.weekday} onChange={(e) => onChange({ ...config, weekday: Number(e.target.value) })}>
                  {Array.from({ length: 7 }, (_, d) => (
                    <option key={d} value={d}>
                      {t(`weekdays.${d}` as "weekdays.0")}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </div>
          <div>
            <p className="text-sm font-medium">{t("segment")}</p>
            <p className="mb-1.5 text-xs text-muted-foreground">{t("segmentHelp")}</p>
            <RuleEditor rules={config.segment} onChange={(segment) => onChange({ ...config, segment })} lookups={lookups} />
            <SegmentPreview rules={config.segment} />
          </div>
        </>
      )}
      {config.kind === "webhook" && (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">{t("webhookHelp")}</p>
          {webhook.url ? (
            <Alert tone="warning" title={t("tokenShownOnce")}>
              <div className="mt-1 flex items-center gap-2">
                <code dir="ltr" className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs text-foreground">
                  {webhook.url}
                </code>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("copy")}
                  onClick={() => navigator.clipboard.writeText(webhook.url!).then(() => toast.success(t("copied")))}
                >
                  <Copy />
                </Button>
              </div>
            </Alert>
          ) : (
            <p className="text-xs text-muted-foreground">{webhook.published && webhook.hasToken ? t("webhookTokenHidden") : t("webhookAfterPublish")}</p>
          )}
          {webhook.published && (
            <Button type="button" variant="secondary" size="sm" onClick={webhook.onRotate} loading={webhook.rotating}>
              <RefreshCw /> {t("rotateToken")}
            </Button>
          )}
        </div>
      )}
      {config.kind === "manual" && <p className="text-sm text-muted-foreground">{t("manualHelp")}</p>}
    </>
  );
}

function SegmentPreview({ rules }: { rules: Rule[] }) {
  const t = useTranslations("automation");
  const [result, setResult] = useState<{ matches: number; scanned: number } | null>(null);
  const { run, pending } = useServerAction(previewSegmentAction, { onSuccess: setResult });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" size="sm" loading={pending} onClick={() => run({ rules })}>
        <Users /> {t("previewSegment")}
      </Button>
      {result && (
        <span className="text-xs text-muted-foreground" role="status">
          {t("segmentMatches", result)}
        </span>
      )}
    </div>
  );
}

type ActionCfg = Extract<WorkflowNode, { type: "action" }>["config"];

function ActionConfig({ config, onChange, lookups, available }: { config: ActionCfg; onChange: (c: ActionCfg) => void; lookups: BuilderLookups; available: Set<ActionType> }) {
  const t = useTranslations("automation");
  const p = config.params as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => onChange({ ...config, params: { ...p, ...patch } });
  const parsed = ACTION_PARAMS[config.action].safeParse(p);
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const id = (k: string) => `param-${k}`;

  const text = (k: string, label: string, opts: { multiline?: boolean; hint?: boolean; ltr?: boolean } = {}) => (
    <Field label={label} htmlFor={id(k)} hint={opts.hint ? t("interpolationHint") : undefined}>
      {opts.multiline ? (
        <Textarea id={id(k)} rows={4} value={str(k)} onChange={(e) => set({ [k]: e.target.value })} dir="auto" />
      ) : (
        <Input id={id(k)} value={str(k)} onChange={(e) => set({ [k]: e.target.value })} dir={opts.ltr ? "ltr" : "auto"} />
      )}
    </Field>
  );
  const select = (k: string, label: string, options: { value: string; label: string }[], allowEmpty = false) => (
    <Field label={label} htmlFor={id(k)}>
      <NativeSelect id={id(k)} value={str(k)} onChange={(e) => set({ [k]: e.target.value || undefined })}>
        {allowEmpty && <option value="">—</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
  const members = lookups.members.map((m) => ({ value: m.userId, label: m.fullName }));

  return (
    <>
      <Field label={t("actionType")} htmlFor="action-type">
        <NativeSelect
          id="action-type"
          value={config.action}
          onChange={(e) => {
            const action = e.target.value as ActionType;
            onChange({ action, params: { ...DEFAULT_PARAMS[action] } });
          }}
        >
          {ACTION_TYPES.map((a) => (
            <option key={a} value={a}>
              {t(`actions.${a}`)}
              {available.has(a) ? "" : ` (${t("actionUnavailableShort")})`}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {!available.has(config.action) && <Alert tone="warning">{t("actionUnavailable")}</Alert>}

      {(config.action === "add_tag" || config.action === "remove_tag") &&
        select("tagId", t("params.tag"), lookups.tags.map((x) => ({ value: x.id, label: x.name })), true)}
      {config.action === "update_contact_stage" && <StageSelect value={str("stage")} onChange={(stage) => set({ stage })} />}
      {config.action === "update_lead_status" &&
        select("status", t("params.status"), (["new", "contacted", "qualified", "unqualified"] as const).map((s) => ({ value: s, label: t(`leadStatuses.${s}`) })))}
      {config.action === "move_deal_stage" &&
        select("stageId", t("params.dealStage"), lookups.stages.map((s) => ({ value: s.id, label: `${s.pipelineName} · ${s.name}` })), true)}
      {config.action === "add_note" && text("body", t("params.body"), { multiline: true, hint: true })}
      {config.action === "assign_owner" && (
        <>
          {select("strategy", t("params.strategy"), [
            { value: "round_robin", label: t("params.roundRobin") },
            { value: "user", label: t("params.specificUser") },
          ])}
          {p.strategy === "user" && select("userId", t("params.user"), members, true)}
        </>
      )}
      {config.action === "notify_user" && (
        <>
          {select("target", t("params.target"), [
            { value: "owner", label: t("params.targetOwner") },
            { value: "user", label: t("params.targetUser") },
          ])}
          {p.target === "user" && select("userId", t("params.user"), members, true)}
          {text("title", t("params.title"), { hint: true })}
          {text("body", t("params.body"), { multiline: true })}
        </>
      )}
      {config.action === "send_email" && (
        <>
          {select("to", t("params.to"), [
            { value: "owner", label: t("params.toOwner") },
            { value: "contact", label: t("params.toContact") },
            { value: "address", label: t("params.toAddress") },
          ])}
          {p.to === "address" && text("address", t("params.address"), { ltr: true })}
          {text("subject", t("params.subject"), { hint: true })}
          {text("body", t("params.body"), { multiline: true })}
        </>
      )}
      {config.action === "create_task" && (
        <>
          {text("title", t("params.title"), { hint: true })}
          {text("description", t("params.description"), { multiline: true })}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("params.dueInDays")} htmlFor={id("dueInDays")}>
              <Input id={id("dueInDays")} type="number" min={0} max={365} value={Number(p.dueInDays ?? 1)} onChange={(e) => set({ dueInDays: clampInt(e.target.value, 0, 365) })} />
            </Field>
            {select("priority", t("params.priority"), (["low", "medium", "high", "urgent"] as const).map((x) => ({ value: x, label: t(`priorities.${x}`) })))}
          </div>
          {select("assignTo", t("params.assignTo"), [
            { value: "owner", label: t("params.targetOwner") },
            { value: "user", label: t("params.specificUser") },
          ])}
          {p.assignTo === "user" && select("userId", t("params.user"), members, true)}
        </>
      )}
      {config.action === "send_whatsapp_template" && (
        <>
          {text("templateName", t("params.templateName"), { ltr: true })}
          {select("language", t("params.language"), [
            { value: "he", label: "עברית (he)" },
            { value: "en", label: "English (en)" },
            { value: "en_US", label: "English US (en_US)" },
            { value: "ar", label: "العربية (ar)" },
          ])}
          <Field label={t("params.templateParams")} htmlFor={id("params")} hint={t("interpolationHint")}>
            <Textarea
              id={id("params")}
              rows={3}
              dir="auto"
              value={Array.isArray(p.params) ? (p.params as string[]).join("\n") : ""}
              onChange={(e) => set({ params: e.target.value.split("\n").slice(0, 10) })}
            />
          </Field>
          <p className="text-xs text-muted-foreground">{t("whatsappConsentNote")}</p>
        </>
      )}
      {config.action === "send_whatsapp_text" && (
        <>
          {text("text", t("params.text"), { multiline: true, hint: true })}
          <p className="text-xs text-muted-foreground">{t("whatsappWindowNote")}</p>
        </>
      )}
      {config.action === "call_webhook" && (
        <>
          {text("url", t("params.url"), { ltr: true })}
          <p className="text-xs text-muted-foreground">{t("webhookCallNote")}</p>
        </>
      )}
      {!parsed.success && <p className="text-xs text-danger-foreground">{t("paramsIncomplete")}</p>}
    </>
  );
}

function StageSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations("automation");
  const tc = useTranslations("contacts");
  return (
    <Field label={t("params.stage")} htmlFor="param-stage">
      <NativeSelect id="param-stage" value={value} onChange={(e) => onChange(e.target.value)}>
        {LIFECYCLE_STAGES.map((s) => (
          <option key={s} value={s}>
            {tc(`stages.${s}`)}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
