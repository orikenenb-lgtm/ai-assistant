import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { sendEmail } from "../email";
import { env } from "../env";
import { purgeRateLimitCounters } from "../rate-limit";
import { registerJobHandler, PermanentJobError } from "./runner";
import { registerSchedule } from "./scheduler";
import { isActiveMember } from "../rbac/membership";

registerJobHandler("maintenance.purge", async () => {
  await purgeRateLimitCounters();
  await db().execute(sql`delete from public.jobs where status in ('succeeded', 'canceled') and finished_at < now() - interval '7 days'`);
  await db().execute(sql`delete from public.webhook_events where status in ('processed', 'ignored') and received_at < now() - interval '30 days'`);
  // Email bodies carry one-time links (invites, quotes, resets): keep them only briefly.
  await db().execute(sql`delete from public.email_outbox where created_at < now() - interval '7 days'`);
  if (env().AUTH_PROVIDER === "local") {
    await db().execute(sql`delete from auth.local_sessions where expires_at < now() - interval '1 day' or revoked_at < now() - interval '7 days'`);
    await db().execute(sql`delete from auth.local_tokens where expires_at < now() - interval '1 day'`);
  }
});
registerSchedule({ name: "maintenance.purge", everyMinutes: 60, job: { tenantId: null, type: "maintenance.purge" } });

registerJobHandler("email.notification", async (job) => {
  const p = job.payload as { userId?: string; title?: string; body?: string; link?: string };
  if (!p.userId || !p.title) throw new PermanentJobError("invalid payload");
  const [profile] = await db().select().from(schema.profiles).where(eq(schema.profiles.id, p.userId));
  if (!profile || !job.tenantId || !(await isActiveMember(job.tenantId, p.userId))) return;
  await sendEmail({
    to: profile.email,
    template: "notification",
    locale: profile.locale === "en" ? "en" : "he",
    tenantId: job.tenantId,
    data: { name: profile.fullName, title: p.title, body: p.body ?? "", url: `${env().APP_URL}${p.link ?? "/"}` },
  });
});
