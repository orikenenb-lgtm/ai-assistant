import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import type { ServiceCtx } from "@/server/context";
import { PermanentJobError } from "@/server/jobs/runner";
import { audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { sendEmail } from "@/server/email";
import { notify } from "@/modules/notifications/service";
import { addNote } from "@/modules/crm/activities";
import { setContactTags } from "@/modules/crm/contacts/service";
import type { ActionType } from "./definition";
import { ACTION_PARAMS } from "./action-params";
import { interpolate } from "./rules";
import type { RunContext } from "./run-context";

/**
 * Automation actions. Each module can register its own (tasks, WhatsApp,
 * deals…). Actions run in a system context scoped to the run's tenant with
 * actorType 'automation' and an incremented event depth (loop prevention).
 */
export type AutomationAction<S extends z.ZodType = z.ZodType> = {
  params: S;
  /** Entities the action needs in the run context. */
  requires?: ("contact" | "deal" | "lead" | "conversation")[];
  run: (ctx: ServiceCtx, params: z.infer<S>, run: RunContext) => Promise<Record<string, unknown>>;
};

const registry = new Map<ActionType, AutomationAction>();

export function registerAutomationAction<S extends z.ZodType>(type: ActionType, action: AutomationAction<S>) {
  registry.set(type, action as unknown as AutomationAction);
}

export function getAutomationAction(type: ActionType): AutomationAction | undefined {
  return registry.get(type);
}

export function availableActionTypes(): ActionType[] {
  return [...registry.keys()];
}

function needContact(run: RunContext) {
  if (!run.contact) throw new PermanentJobError("this action needs a contact in the trigger");
  return run.contact;
}

registerAutomationAction("add_tag", {
  params: ACTION_PARAMS.add_tag,
  requires: ["contact"],
  run: async (ctx, p, run) => {
    const c = needContact(run);
    await setContactTags(ctx, c.id, [...new Set([...c.tags, p.tagId])]);
    return { tagId: p.tagId };
  },
});

registerAutomationAction("remove_tag", {
  params: ACTION_PARAMS.remove_tag,
  requires: ["contact"],
  run: async (ctx, p, run) => {
    const c = needContact(run);
    await setContactTags(ctx, c.id, c.tags.filter((t) => t !== p.tagId));
    return { tagId: p.tagId };
  },
});

registerAutomationAction("update_contact_stage", {
  params: ACTION_PARAMS.update_contact_stage,
  requires: ["contact"],
  run: async (ctx, p, run) => {
    const c = needContact(run);
    if (c.lifecycleStage === p.stage) return { unchanged: true };
    await ctx.run(async (tx) => {
      await tx
        .update(schema.contacts)
        .set({ lifecycleStage: p.stage })
        .where(and(eq(schema.contacts.id, c.id), eq(schema.contacts.tenantId, ctx.tenantId)));
      await audit(tx, ctx, { action: "contact.updated", entityType: "contact", entityId: c.id, metadata: { changed: ["lifecycleStage"], via: "automation" } });
      await emitEvent(tx, ctx, {
        type: "contact.updated",
        entityType: "contact",
        entityId: c.id,
        data: { changed: ["lifecycleStage"], lifecycleStage: p.stage, previousLifecycleStage: c.lifecycleStage },
      });
    });
    return { stage: p.stage };
  },
});

registerAutomationAction("add_note", {
  params: ACTION_PARAMS.add_note,
  run: async (ctx, p, run) => {
    const target = run.deal ? { kind: "deal" as const, id: run.deal.id } : run.lead ? { kind: "lead" as const, id: run.lead.id } : run.contact ? { kind: "contact" as const, id: run.contact.id } : null;
    if (!target) throw new PermanentJobError("no record to attach the note to");
    const note = await addNote(ctx, target.kind, target.id, interpolate(p.body, run.data));
    return { noteId: note.id };
  },
});

/** Resolves "owner of the triggering record" (deal → lead → contact). */
function recordOwner(run: RunContext): string | null {
  return run.deal?.ownerId ?? run.lead?.ownerId ?? run.contact?.ownerId ?? null;
}

registerAutomationAction("notify_user", {
  params: ACTION_PARAMS.notify_user,
  run: async (ctx, p, run) => {
    const userId = p.target === "user" ? p.userId : recordOwner(run);
    if (!userId) return { skipped: "no recipient" };
    await notify(db(), {
      tenantId: ctx.tenantId,
      userId,
      type: "mention",
      title: interpolate(p.title, run.data),
      body: interpolate(p.body, run.data),
      link: run.deal ? `/deals/${run.deal.id}` : run.lead ? `/leads/${run.lead.id}` : run.contact ? `/contacts/${run.contact.id}` : undefined,
    });
    return { userId };
  },
});

registerAutomationAction("send_email", {
  params: ACTION_PARAMS.send_email,
  run: async (ctx, p, run) => {
    let to: string | null = null;
    if (p.to === "address") to = p.address ?? null;
    if (p.to === "contact") to = run.contact?.email ?? null;
    if (p.to === "owner") {
      const owner = recordOwner(run);
      if (owner) [{ email: to }] = await db().select({ email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.id, owner));
    }
    if (!to) return { skipped: "no email address" };
    const [tenant] = await db().select({ locale: schema.tenants.locale }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId));
    await sendEmail({
      to,
      template: "automation_email",
      locale: tenant?.locale === "en" ? "en" : "he",
      tenantId: ctx.tenantId,
      data: { subject: interpolate(p.subject, run.data), body: interpolate(p.body, run.data) },
    });
    return { to };
  },
});

/** Picks the active agent/manager owning the fewest open records (fair round-robin). */
async function roundRobinAssignee(tenantId: string): Promise<string | null> {
  const rows = await db().execute<{ user_id: string }>(sql`
    select m.user_id
    from public.memberships m
    left join public.contacts c on c.owner_id = m.user_id and c.tenant_id = m.tenant_id and c.deleted_at is null and c.created_at > now() - interval '30 days'
    where m.tenant_id = ${tenantId} and m.status = 'active' and m.role in ('agent', 'manager')
    group by m.user_id
    order by count(c.id) asc, m.user_id
    limit 1`);
  return rows[0]?.user_id ?? null;
}

registerAutomationAction("assign_owner", {
  params: ACTION_PARAMS.assign_owner,
  run: async (ctx, p, run) => {
    const userId = p.strategy === "user" ? p.userId : await roundRobinAssignee(ctx.tenantId);
    if (!userId) return { skipped: "no assignee" };
    const [member] = await db()
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.tenantId, ctx.tenantId), eq(schema.memberships.userId, userId), eq(schema.memberships.status, "active")));
    if (!member) throw new PermanentJobError("assignee is not an active member");
    const target = run.deal ? { table: schema.deals, id: run.deal.id, kind: "deal" } : run.lead ? { table: schema.leads, id: run.lead.id, kind: "lead" } : run.contact ? { table: schema.contacts, id: run.contact.id, kind: "contact" } : null;
    if (!target) throw new PermanentJobError("no record to assign");
    await ctx.run(async (tx) => {
      await tx.update(target.table).set({ ownerId: userId }).where(and(eq(target.table.id, target.id), eq(target.table.tenantId, ctx.tenantId)));
      await audit(tx, ctx, { action: `${target.kind}.assigned`, entityType: target.kind, entityId: target.id, metadata: { ownerId: userId, via: "automation" } });
    });
    await notify(db(), {
      tenantId: ctx.tenantId,
      userId,
      type: run.lead ? "lead_assigned" : "mention",
      title: { he: "שויכה אליך רשומה חדשה (אוטומציה)", en: "A record was assigned to you (automation)" },
      link: run.deal ? `/deals/${run.deal.id}` : run.lead ? `/leads/${run.lead.id}` : run.contact ? `/contacts/${run.contact!.id}` : undefined,
    });
    return { userId };
  },
});

/** Member list used by the builder UI. */
export async function automationMembers(tenantId: string) {
  return db()
    .select({ userId: schema.profiles.id, fullName: schema.profiles.fullName })
    .from(schema.memberships)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.status, "active")))
    .orderBy(asc(schema.profiles.fullName));
}

export async function contactTagIds(contactId: string): Promise<string[]> {
  const rows = await db().select({ tagId: schema.contactTags.tagId }).from(schema.contactTags).where(eq(schema.contactTags.contactId, contactId));
  return rows.map((r) => r.tagId);
}

