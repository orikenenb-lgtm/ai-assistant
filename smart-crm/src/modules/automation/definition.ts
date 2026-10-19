import { z } from "zod";
import { DOMAIN_EVENTS } from "@/lib/domain-events";

/** Workflow graph format shared by the builder (client) and the engine (server). */

export const RULE_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "in", "is_empty", "is_not_empty", "has_tag", "not_has_tag"] as const;
export type RuleOp = (typeof RULE_OPS)[number];

/** Whitelisted fields a rule may read from the run context. */
export const RULE_FIELDS = [
  "contact.firstName",
  "contact.lastName",
  "contact.email",
  "contact.phone",
  "contact.lifecycleStage",
  "contact.source",
  "contact.whatsappConsent",
  "contact.ownerId",
  "contact.tags",
  "deal.title",
  "deal.valueCents",
  "deal.status",
  "deal.stageId",
  "deal.pipelineId",
  "deal.ownerId",
  "lead.status",
  "lead.source",
  "lead.score",
  "lead.aiClassification",
  "message.body",
  "message.type",
  "event.data.toStageId",
  "event.data.fromStageId",
  "event.data.tagId",
  "event.data.status",
  "event.data.source",
  "event.data.lifecycleStage",
  "payload",
] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const ruleSchema = z.object({
  field: z.string().regex(/^(contact|deal|lead|message|event\.data|payload)(\.[a-zA-Z0-9_]+)*$/).max(80),
  op: z.enum(RULE_OPS),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)]).optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const segmentRulesSchema = z.array(ruleSchema).max(10);

export const conditionConfigSchema = z.object({ match: z.enum(["all", "any"]).default("all"), rules: z.array(ruleSchema).min(1).max(20) });

export const TRIGGER_EVENTS = DOMAIN_EVENTS;

export const triggerConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), event: z.enum(DOMAIN_EVENTS), filters: z.array(ruleSchema).max(10).default([]) }),
  z.object({
    kind: z.literal("schedule"),
    frequency: z.enum(["hourly", "daily", "weekly"]),
    hour: z.number().int().min(0).max(23).default(9),
    weekday: z.number().int().min(0).max(6).default(0),
    /** Contacts matching these rules get one run per schedule slot. */
    segment: z.array(ruleSchema).max(10).default([]),
  }),
  z.object({ kind: z.literal("webhook") }),
  z.object({ kind: z.literal("manual") }),
]);
export type TriggerConfig = z.infer<typeof triggerConfigSchema>;

export const ACTION_TYPES = [
  "send_whatsapp_template",
  "send_whatsapp_text",
  "create_task",
  "assign_owner",
  "add_tag",
  "remove_tag",
  "update_contact_stage",
  "update_lead_status",
  "move_deal_stage",
  "add_note",
  "notify_user",
  "send_email",
  "call_webhook",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const actionConfigSchema = z.object({ action: z.enum(ACTION_TYPES), params: z.record(z.string(), z.unknown()).default({}) });

export const delayConfigSchema = z.object({ amount: z.number().int().min(1).max(365), unit: z.enum(["minutes", "hours", "days"]) });

const position = z.object({ x: z.number(), y: z.number() });

export const nodeSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1).max(40), type: z.literal("trigger"), config: triggerConfigSchema, position }),
  z.object({ id: z.string().min(1).max(40), type: z.literal("condition"), config: conditionConfigSchema, position }),
  z.object({ id: z.string().min(1).max(40), type: z.literal("action"), config: actionConfigSchema, position }),
  z.object({ id: z.string().min(1).max(40), type: z.literal("delay"), config: delayConfigSchema, position }),
]);
export type WorkflowNode = z.infer<typeof nodeSchema>;

export const edgeSchema = z.object({
  id: z.string().min(1).max(80),
  source: z.string(),
  target: z.string(),
  /** For condition nodes: which branch this edge follows. */
  branch: z.enum(["true", "false"]).optional(),
});
export type WorkflowEdge = z.infer<typeof edgeSchema>;

export const MAX_NODES = 50;

export const definitionSchema = z
  .object({ nodes: z.array(nodeSchema).min(1).max(MAX_NODES), edges: z.array(edgeSchema).max(MAX_NODES * 2) })
  .superRefine((def, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    const ids = new Set(def.nodes.map((n) => n.id));
    if (ids.size !== def.nodes.length) issue("automation.duplicateNodeIds");
    const triggers = def.nodes.filter((n) => n.type === "trigger");
    if (triggers.length !== 1) issue("automation.exactlyOneTrigger");
    for (const e of def.edges) {
      if (!ids.has(e.source) || !ids.has(e.target)) issue("automation.danglingEdge");
      if (e.source === e.target) issue("automation.selfLoop");
    }
    for (const n of def.nodes) {
      const out = def.edges.filter((e) => e.source === n.id);
      if (n.type === "condition") {
        if (out.some((e) => !e.branch)) issue("automation.conditionNeedsBranch");
      } else if (out.length > 1) {
        issue("automation.singleOutgoing");
      }
      if (n.type === "trigger" && def.edges.some((e) => e.target === n.id)) issue("automation.triggerHasInput");
    }
    // The graph must be acyclic (no infinite loops by construction).
    const adj = new Map<string, string[]>();
    for (const e of def.edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    const state = new Map<string, 1 | 2>();
    const dfs = (id: string): boolean => {
      state.set(id, 1);
      for (const nxt of adj.get(id) ?? []) {
        if (state.get(nxt) === 1) return true;
        if (!state.has(nxt) && dfs(nxt)) return true;
      }
      state.set(id, 2);
      return false;
    };
    if ([...ids].some((id) => !state.has(id) && dfs(id))) issue("automation.cycle");
  });
export type WorkflowDefinition = z.infer<typeof definitionSchema>;

export function triggerOf(def: WorkflowDefinition): Extract<WorkflowNode, { type: "trigger" }> {
  return def.nodes.find((n) => n.type === "trigger") as Extract<WorkflowNode, { type: "trigger" }>;
}

/** Stored trigger_type column value (fast lookup of active workflows per event). */
export function triggerType(def: WorkflowDefinition): string {
  const t = triggerOf(def).config;
  return t.kind === "event" ? `event:${t.event}` : t.kind;
}

export function nextNodes(def: WorkflowDefinition, nodeId: string, branch?: boolean): string[] {
  return def.edges
    .filter((e) => e.source === nodeId && (branch === undefined || e.branch === (branch ? "true" : "false")))
    .map((e) => e.target);
}
