import { and, eq, sql } from "drizzle-orm";
import { db, schema, withSystemTx } from "@/server/db";
import { assertCan, assertWritable, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import type { CalendarProvider, CalendarTokens } from "./providers";

export type ConnectionView = {
  id: string;
  provider: string;
  status: string;
  accountEmail: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
};

/** Global flag + per-tenant override for the (not yet live) calendar sync. */
export async function calendarSyncEnabled(tenantId: string): Promise<boolean> {
  const [row] = await db().execute<{ enabled: boolean }>(sql`
    select coalesce(
      (select enabled from public.tenant_feature_flags where tenant_id = ${tenantId} and flag_key = 'calendar.sync'),
      (select enabled from public.feature_flags where key = 'calendar.sync'),
      false) as enabled`);
  return Boolean(row?.enabled);
}

export async function listMyConnections(ctx: ServiceCtx): Promise<ConnectionView[]> {
  assertCan(ctx, "calendar.view");
  if (!ctx.userId) return [];
  return ctx.run((tx) =>
    tx
      .select({
        id: schema.calendarConnections.id,
        provider: schema.calendarConnections.provider,
        status: schema.calendarConnections.status,
        accountEmail: schema.calendarConnections.accountEmail,
        lastSyncedAt: schema.calendarConnections.lastSyncedAt,
        lastError: schema.calendarConnections.lastError,
      })
      .from(schema.calendarConnections)
      .where(and(eq(schema.calendarConnections.tenantId, ctx.tenantId), eq(schema.calendarConnections.userId, ctx.userId!))),
  );
}

/**
 * Stores OAuth tokens encrypted (AES-256-GCM, bound to the connection by AAD)
 * in public.secrets. Connections and secrets are system-written: app users can
 * only read and delete their own connection rows.
 */
export async function saveConnection(
  ctx: ServiceCtx,
  provider: "google" | "microsoft",
  tokens: CalendarTokens,
): Promise<string> {
  assertWritable(ctx);
  assertCan(ctx, "calendar.manage");
  if (!ctx.userId) throw new AppError("FORBIDDEN", "errors.forbidden");
  const userId = ctx.userId;
  return withSystemTx(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.calendarConnections)
      .where(
        and(
          eq(schema.calendarConnections.tenantId, ctx.tenantId),
          eq(schema.calendarConnections.userId, userId),
          eq(schema.calendarConnections.provider, provider),
        ),
      );
    const aad = `calendar:${ctx.tenantId}:${userId}:${provider}`;
    const ciphertext = encryptSecret(JSON.stringify(tokens), aad);
    let secretId = existing?.secretId ?? null;
    if (secretId) {
      await tx.update(schema.secrets).set({ ciphertext, rotatedAt: new Date() }).where(eq(schema.secrets.id, secretId));
    } else {
      const [secret] = await tx.insert(schema.secrets).values({ tenantId: ctx.tenantId, kind: "calendar_oauth", ciphertext }).returning({ id: schema.secrets.id });
      secretId = secret.id;
    }
    let id: string;
    if (existing) {
      await tx
        .update(schema.calendarConnections)
        .set({ status: "connected", secretId, accountEmail: tokens.accountEmail, scopes: tokens.scope.split(" "), lastError: null })
        .where(eq(schema.calendarConnections.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await tx
        .insert(schema.calendarConnections)
        .values({ tenantId: ctx.tenantId, userId, provider, status: "connected", secretId, accountEmail: tokens.accountEmail, scopes: tokens.scope.split(" ") })
        .returning({ id: schema.calendarConnections.id });
      id = row.id;
    }
    await audit(tx, ctx, { action: "calendar.connected", entityType: "calendar_connection", entityId: id, metadata: { provider } });
    return id;
  });
}

export async function loadConnectionTokens(connectionId: string): Promise<{ tenantId: string; userId: string; provider: string; tokens: CalendarTokens }> {
  const [row] = await db()
    .select({ c: schema.calendarConnections, ciphertext: schema.secrets.ciphertext })
    .from(schema.calendarConnections)
    .innerJoin(schema.secrets, eq(schema.secrets.id, schema.calendarConnections.secretId))
    .where(eq(schema.calendarConnections.id, connectionId));
  if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
  const aad = `calendar:${row.c.tenantId}:${row.c.userId}:${row.c.provider}`;
  return { tenantId: row.c.tenantId, userId: row.c.userId, provider: row.c.provider, tokens: JSON.parse(decryptSecret(row.ciphertext, aad)) as CalendarTokens };
}

export async function disconnect(ctx: ServiceCtx, connectionId: string) {
  assertWritable(ctx);
  await ctx.run(async (tx) => {
    const [row] = await tx
      .delete(schema.calendarConnections)
      .where(and(eq(schema.calendarConnections.id, connectionId), eq(schema.calendarConnections.tenantId, ctx.tenantId), eq(schema.calendarConnections.userId, ctx.userId!)))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "errors.notFound");
    await audit(tx, ctx, { action: "calendar.disconnected", entityType: "calendar_connection", entityId: connectionId, metadata: { provider: row.provider } });
  });
  // Secret removal is a system write (app users cannot touch public.secrets).
  await db().execute(sql`delete from public.secrets s where s.kind = 'calendar_oauth' and s.tenant_id = ${ctx.tenantId}
    and not exists (select 1 from public.calendar_connections c where c.secret_id = s.id)`);
}

/**
 * Pulls external events into calendar_events for a connection (idempotent:
 * unique on tenant + provider + external id). Cancelled events are removed.
 */
export async function syncConnection(connectionId: string, provider: CalendarProvider, range: { from: Date; to: Date }) {
  const conn = await loadConnectionTokens(connectionId);
  try {
    const fresh = await provider.ensureFresh(conn.tokens);
    const events = await provider.listEvents(fresh, range);
    const providerKey = conn.provider as "google" | "microsoft";
    await withSystemTx(async (tx) => {
      for (const e of events) {
        if (e.cancelled) {
          await tx
            .delete(schema.calendarEvents)
            .where(
              and(
                eq(schema.calendarEvents.tenantId, conn.tenantId),
                eq(schema.calendarEvents.externalProvider, providerKey),
                eq(schema.calendarEvents.externalId, e.externalId),
              ),
            );
          continue;
        }
        await tx
          .insert(schema.calendarEvents)
          .values({
            tenantId: conn.tenantId,
            title: e.title,
            description: e.description,
            location: e.location,
            startsAt: e.startsAt,
            endsAt: e.endsAt < e.startsAt ? e.startsAt : e.endsAt,
            allDay: e.allDay,
            ownerId: conn.userId,
            externalProvider: providerKey,
            externalId: e.externalId,
            createdBy: conn.userId,
          })
          .onConflictDoUpdate({
            target: [schema.calendarEvents.tenantId, schema.calendarEvents.externalProvider, schema.calendarEvents.externalId],
            targetWhere: sql`external_id is not null`,
            set: { title: e.title, description: e.description, location: e.location, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay },
          });
      }
      await tx.update(schema.calendarConnections).set({ lastSyncedAt: new Date(), lastError: null, status: "connected" }).where(eq(schema.calendarConnections.id, connectionId));
      if (fresh !== conn.tokens) {
        const [c] = await tx.select().from(schema.calendarConnections).where(eq(schema.calendarConnections.id, connectionId));
        if (c?.secretId) {
          const aad = `calendar:${conn.tenantId}:${conn.userId}:${conn.provider}`;
          await tx.update(schema.secrets).set({ ciphertext: encryptSecret(JSON.stringify(fresh), aad), rotatedAt: new Date() }).where(eq(schema.secrets.id, c.secretId));
        }
      }
    });
    return events.length;
  } catch (e) {
    await db()
      .update(schema.calendarConnections)
      .set({ status: "error", lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
      .where(eq(schema.calendarConnections.id, connectionId));
    throw e;
  }
}
