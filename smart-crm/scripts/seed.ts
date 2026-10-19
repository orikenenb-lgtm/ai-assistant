/**
 * DEMO DATA FOR LOCAL DEVELOPMENT ONLY.  npm run db:seed
 *
 * Creates a demo organization with realistic Hebrew sample data so the UI can
 * be explored. Refuses to run against non-local databases or APP_ENV=production.
 * Sign in with:  owner@demo.test / Demo!Password1   (also manager@ / agent@)
 */
import { sql } from "drizzle-orm";
import { closeDb, db, schema, sqlClient } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { createOrganization } from "../src/modules/org/service";

const url = process.env.DATABASE_URL ?? "";
if (process.env.APP_ENV === "production" || !/(localhost|127\.0\.0\.1)/.test(url)) {
  console.error("seed refuses to run outside a local database");
  process.exit(1);
}

const PASSWORD = "Demo!Password1";

async function user(email: string, fullName: string) {
  const existing = await sqlClient()<{ id: string }[]>`select id from auth.users where email = ${email}`;
  if (existing[0]) return existing[0].id;
  const [row] = await sqlClient()<{ id: string }[]>`
    insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
    values (${email}, ${await hashPassword(PASSWORD)}, now(), ${JSON.stringify({ full_name: fullName, locale: "he" })}::text::jsonb)
    returning id`;
  return row.id;
}

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400_000);
}

async function main() {
  const ownerId = await user("owner@demo.test", "אורי כרם");
  const managerId = await user("manager@demo.test", "מיכל לוי");
  const agentId = await user("agent@demo.test", "דניאל כהן");
  const already = await db().execute<{ id: string }>(sql`select t.id from public.tenants t join public.memberships m on m.tenant_id = t.id where m.user_id = ${ownerId} limit 1`);
  if (already[0]) {
    console.log("demo data already present — run `npm run db:reset` first to rebuild");
    return;
  }
  const tenant = await createOrganization(ownerId, { name: "כרם טויס (דמו)", locale: "he" });
  const t = tenant.id;
  await db().insert(schema.memberships).values([
    { tenantId: t, userId: managerId, role: "manager" },
    { tenantId: t, userId: agentId, role: "agent" },
  ]);
  await db().update(schema.profiles).set({ isSuperAdmin: true }).where(sql`id = ${ownerId}`);

  const tags = await db()
    .insert(schema.tags)
    .values([
      { tenantId: t, name: "סיטונאי", color: "#6366f1" },
      { tenantId: t, name: "VIP", color: "#ef4444" },
      { tenantId: t, name: "חנות צעצועים", color: "#10b981" },
      { tenantId: t, name: "רשת", color: "#f59e0b" },
    ])
    .returning();

  const companies = await db()
    .insert(schema.companies)
    .values([
      { tenantId: t, name: "צעצועי הצפון", city: "חיפה", industry: "קמעונאות", sizeRange: "11-50", phone: "+97248123456", ownerId: managerId },
      { tenantId: t, name: "עולם המשחקים", city: "תל אביב", industry: "קמעונאות", sizeRange: "51-200", website: "https://example.com", ownerId: agentId },
      { tenantId: t, name: "גן שעשועים בע״מ", city: "באר שבע", industry: "חינוך", sizeRange: "1-10", ownerId: agentId },
      { tenantId: t, name: "טויז סנטר", city: "ירושלים", industry: "קמעונאות", sizeRange: "201-1000", ownerId: managerId },
    ])
    .returning();

  const people: [string, string, string, string, number, string][] = [
    ["רונית", "לוי", "+972501234567", "ronit@example.test", 0, "customer"],
    ["יוסי", "מזרחי", "+972521112233", "yossi@example.test", 0, "opportunity"],
    ["שירה", "אברהם", "+972543334455", "shira@example.test", 1, "customer"],
    ["אבי", "דוד", "+972505556677", "avi@example.test", 1, "lead"],
    ["נועה", "פרץ", "+972537778899", "noa@example.test", 2, "lead"],
    ["משה", "ביטון", "+972509990011", "moshe@example.test", 3, "customer"],
    ["תמר", "גולן", "+972522223344", "tamar@example.test", 3, "opportunity"],
    ["Daniel", "Smith", "+14155550123", "daniel@example.test", 1, "subscriber"],
  ];
  const contacts = [];
  for (const [i, [first, last, phone, email, co, stage]] of people.entries()) {
    const [c] = await db()
      .insert(schema.contacts)
      .values({
        tenantId: t,
        firstName: first,
        lastName: last,
        phone,
        email,
        companyId: companies[co].id,
        lifecycleStage: stage,
        ownerId: [ownerId, managerId, agentId][i % 3],
        whatsappConsent: i % 3 === 0 ? "opted_in" : "unknown",
        source: ["אתר", "הפניה", "תערוכה", "WhatsApp"][i % 4],
        createdAt: daysAgo(40 - i * 4),
        lastActivityAt: daysAgo(i),
      })
      .returning();
    contacts.push(c);
    await db().insert(schema.contactTags).values({ tenantId: t, contactId: c.id, tagId: tags[i % tags.length].id });
    await db().insert(schema.activities).values({ tenantId: t, type: "contact_created", contactId: c.id, actorId: ownerId, occurredAt: daysAgo(40 - i * 4) });
  }
  await db().insert(schema.notes).values({ tenantId: t, contactId: contacts[0].id, body: "הזמינה 3 משטחים לקראת החגים. מעדיפה משלוח בימי ראשון.", authorId: managerId, pinned: true });
  await db().insert(schema.activities).values([
    { tenantId: t, type: "call", subject: "שיחת היכרות", body: "דיברנו על קטלוג החורף", contactId: contacts[0].id, actorId: agentId, occurredAt: daysAgo(2), durationMinutes: 15 },
    { tenantId: t, type: "meeting", subject: "פגישה בחנות", contactId: contacts[1].id, actorId: managerId, occurredAt: daysAgo(5), durationMinutes: 45 },
  ]);
  console.log(`demo tenant ${tenant.name} created — sign in as owner@demo.test / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
