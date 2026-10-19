import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, schema, sqlClient, withSystemTx } from "@/server/db";
import { createOrganization } from "@/modules/org/service";
import { userCtx, systemCtx, type ServiceCtx } from "@/server/context";
import type { Role } from "@/server/rbac/permissions";
import type { CookieJar } from "@/server/auth/local";

export function uniqueEmail(prefix = "user") {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

export async function createUser(opts: { email?: string; fullName?: string; verified?: boolean; superAdmin?: boolean } = {}) {
  const email = opts.email ?? uniqueEmail();
  const [row] = await sqlClient()<{ id: string }[]>`
    insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
    values (${email}, ${opts.verified === false ? null : new Date().toISOString()}, ${JSON.stringify({ full_name: opts.fullName ?? "Test User", locale: "he" })}::jsonb)
    returning id`;
  if (opts.superAdmin) await sqlClient()`update public.profiles set is_super_admin = true where id = ${row.id}`;
  return { id: row.id, email };
}

export async function createTenant(ownerId: string, name = `Org ${randomUUID().slice(0, 6)}`) {
  return createOrganization(ownerId, { name, locale: "he" });
}

export async function addMember(tenantId: string, userId: string, role: Role) {
  await db().insert(schema.memberships).values({ tenantId, userId, role });
}

/** A tenant with an owner, a manager and an agent. */
export async function createTeam(name?: string) {
  const owner = await createUser({ fullName: "Owner" });
  const tenant = await createTenant(owner.id, name);
  const manager = await createUser({ fullName: "Manager" });
  const agent = await createUser({ fullName: "Agent" });
  await addMember(tenant.id, manager.id, "manager");
  await addMember(tenant.id, agent.id, "agent");
  const ctxFor = (userId: string, role: Role): ServiceCtx => userCtx({ tenantId: tenant.id, userId, role });
  return {
    tenant,
    owner,
    manager,
    agent,
    ownerCtx: ctxFor(owner.id, "owner"),
    managerCtx: ctxFor(manager.id, "manager"),
    agentCtx: ctxFor(agent.id, "agent"),
    systemCtx: systemCtx(tenant.id),
  };
}

export function memoryJar(): CookieJar & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (n) => values.get(n),
    set: (n, v) => void values.set(n, v),
    delete: (n) => void values.delete(n),
  };
}

export async function latestEmail(to: string) {
  const rows = await db().execute<{ subject: string; text_body: string; template: string }>(
    sql`select subject, text_body, template from public.email_outbox where lower(to_email) = lower(${to}) order by created_at desc limit 1`,
  );
  return rows[0];
}

export function extractToken(text: string, param = "token"): string {
  const m = new RegExp(`[?&]${param}=([A-Za-z0-9_-]+)`).exec(text);
  if (!m) throw new Error(`no ${param} in email`);
  return m[1];
}

export async function asSystem<T>(fn: Parameters<typeof withSystemTx<T>>[0]) {
  return withSystemTx(fn);
}
