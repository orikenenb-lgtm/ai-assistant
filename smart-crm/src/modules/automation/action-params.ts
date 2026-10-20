import { z } from "zod";
import { LIFECYCLE_STAGES } from "@/modules/crm/schemas";
import type { ActionType } from "./definition";

/**
 * Parameter contracts for every automation action (client-safe). The builder
 * renders forms from these; the modules that implement an action register it
 * with the matching schema.
 */
export const ACTION_PARAMS = {
  send_whatsapp_template: z.object({
    templateName: z.string().min(1).max(512),
    language: z.string().min(2).max(10).default("he"),
    params: z.array(z.string().max(500)).max(10).default([]),
  }),
  send_whatsapp_text: z.object({ text: z.string().min(1).max(4096) }),
  create_task: z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).default(""),
    dueInDays: z.number().int().min(0).max(365).default(1),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    assignTo: z.enum(["owner", "user"]).default("owner"),
    userId: z.uuid().optional(),
  }),
  assign_owner: z.object({ strategy: z.enum(["user", "round_robin"]), userId: z.uuid().optional() }),
  add_tag: z.object({ tagId: z.uuid() }),
  remove_tag: z.object({ tagId: z.uuid() }),
  update_contact_stage: z.object({ stage: z.enum(LIFECYCLE_STAGES) }),
  update_lead_status: z.object({ status: z.enum(["new", "contacted", "qualified", "unqualified"]) }),
  move_deal_stage: z.object({ stageId: z.uuid() }),
  add_note: z.object({ body: z.string().min(1).max(5000) }),
  notify_user: z.object({ target: z.enum(["owner", "user"]), userId: z.uuid().optional(), title: z.string().min(1).max(200), body: z.string().max(1000).default("") }),
  send_email: z.object({ to: z.enum(["owner", "contact", "address"]), address: z.email().optional(), subject: z.string().min(1).max(200), body: z.string().min(1).max(5000) }),
  call_webhook: z.object({ url: z.url().refine((u) => u.startsWith("https://"), { message: "validation.url" }) }),
} satisfies Record<ActionType, z.ZodType>;

export const DEFAULT_PARAMS: Record<ActionType, Record<string, unknown>> = {
  send_whatsapp_template: { templateName: "", language: "he", params: [] },
  send_whatsapp_text: { text: "" },
  create_task: { title: "", description: "", dueInDays: 1, priority: "medium", assignTo: "owner" },
  assign_owner: { strategy: "round_robin" },
  add_tag: { tagId: "" },
  remove_tag: { tagId: "" },
  update_contact_stage: { stage: "customer" },
  update_lead_status: { status: "contacted" },
  move_deal_stage: { stageId: "" },
  add_note: { body: "" },
  notify_user: { target: "owner", title: "", body: "" },
  send_email: { to: "owner", subject: "", body: "" },
  call_webhook: { url: "https://" },
};
