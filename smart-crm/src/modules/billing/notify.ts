import { and, eq } from "drizzle-orm";
import { schema, type Executor } from "@/server/db";
import { enqueueJob } from "@/server/jobs/queue";

type Localized = { he: string; en: string };

/**
 * Billing alerts go to every active owner: in-app always, and by email when
 * `email` is set (payment failures and downgrades must not be missed).
 * Runs in the caller's (system) transaction.
 */
export async function notifyOwners(tx: Executor, tenantId: string, msg: { title: Localized; body: Localized; link?: string }, opts: { email?: boolean } = {}) {
  const owners = await tx
    .select({ userId: schema.profiles.id, locale: schema.profiles.locale })
    .from(schema.memberships)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.role, "owner"), eq(schema.memberships.status, "active")));
  const link = msg.link ?? "/settings/billing";
  for (const o of owners) {
    const locale = o.locale === "en" ? "en" : "he";
    await tx.insert(schema.notifications).values({
      tenantId,
      userId: o.userId,
      type: "billing",
      title: msg.title[locale].slice(0, 200),
      body: msg.body[locale].slice(0, 1000),
      link,
    });
    if (opts.email) {
      await enqueueJob(tx, {
        tenantId,
        type: "email.notification",
        payload: { userId: o.userId, title: msg.title[locale], body: msg.body[locale], link },
      });
    }
  }
}
