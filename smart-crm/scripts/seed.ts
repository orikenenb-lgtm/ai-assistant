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
import { syncSeatsNow } from "../src/modules/billing/seats";

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
  await seedSalesHistory(t, [ownerId, managerId, agentId], contacts.map((c) => c.id), companies.map((c) => c.id));
  await syncSeatsNow(t);
  console.log(`demo tenant ${tenant.name} created — sign in as owner@demo.test / ${PASSWORD}`);
}

/** Deterministic PRNG so demo data looks the same on every reset. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A year of sales history for the analytics screens: deals with realistic
 * stage paths, leads by source, WhatsApp conversations with response times,
 * tasks and logged activities.
 */
async function seedSalesHistory(t: string, users: string[], contactIds: string[], companyIds: string[]) {
  const rnd = prng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const DAY = 86_400_000;
  const now = Date.now();
  const at = (ms: number) => new Date(Math.min(ms, now - 60_000));

  const [pipeline] = await db().select().from(schema.pipelines).where(sql`tenant_id = ${t}`);
  const stages = await db().select().from(schema.pipelineStages).where(sql`pipeline_id = ${pipeline.id}`).orderBy(schema.pipelineStages.position);
  const open = stages.filter((s) => s.kind === "open");
  const wonStage = stages.find((s) => s.kind === "won")!;
  const lostStage = stages.find((s) => s.kind === "lost")!;
  const reasons = await db().select().from(schema.lostReasons).where(sql`tenant_id = ${t}`);

  // More contacts spread over the year so growth charts have a shape.
  const firstNames = ["אורית", "גיל", "הדס", "עומר", "ליאת", "רועי", "מאיה", "איתי", "שני", "בועז", "ענבל", "ניר", "דנה", "יואב", "קרן", "אלון"];
  const lastNames = ["שפירא", "אוחיון", "ברק", "חדד", "זילבר", "נחום", "רוזן", "סויסה"];
  for (let i = 0; i < 24; i++) {
    const [c] = await db()
      .insert(schema.contacts)
      .values({
        tenantId: t,
        firstName: pick(firstNames),
        lastName: pick(lastNames),
        phone: `+97250${String(1_000_000 + i * 7919).slice(0, 7)}`,
        lifecycleStage: pick(["lead", "lead", "customer", "opportunity", "subscriber", "churned"]),
        ownerId: pick(users),
        companyId: rnd() < 0.5 ? pick(companyIds) : null,
        createdAt: at(now - between(5, 360) * DAY),
      })
      .returning({ id: schema.contacts.id });
    contactIds.push(c.id);
  }

  // Deals: closed ones carry a full stage path; open ones sit in an open stage.
  for (let i = 0; i < 44; i++) {
    const created = now - (365 - i * 8) * DAY + between(0, 3) * DAY;
    const age = (now - created) / DAY;
    const roll = rnd();
    const outcome = age > 45 ? (roll < 0.58 ? "won" : roll < 0.9 ? "lost" : "open") : "open";
    const closeAfter = between(8, 40);
    const finalOpen = outcome === "open" ? pick(open) : outcome === "lost" ? open[between(0, open.length - 1)] : open[open.length - 1];
    const stage = outcome === "won" ? wonStage : outcome === "lost" ? lostStage : finalOpen;
    const closedAt = at(created + closeAfter * DAY);
    const [deal] = await db()
      .insert(schema.deals)
      .values({
        tenantId: t,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: `${pick(["הזמנת חורף", "מלאי חגים", "קולקציית קיץ", "הזמנה חוזרת", "פתיחת סניף", "מבצע סוף עונה"])} #${i + 1}`,
        valueCents: between(20, 600) * 10_000,
        status: outcome,
        contactId: pick(contactIds),
        companyId: rnd() < 0.6 ? pick(companyIds) : null,
        ownerId: pick(users),
        createdAt: new Date(created),
        wonAt: outcome === "won" ? closedAt : null,
        lostAt: outcome === "lost" ? closedAt : null,
        lostReasonId: outcome === "lost" ? pick(reasons).id : null,
        expectedCloseDate: outcome === "open" ? new Date(now + between(-10, 75) * DAY).toISOString().slice(0, 10) : null,
      })
      .returning();
    // Replace the trigger's single "now" row with a realistic path.
    await db().delete(schema.dealStageHistory).where(sql`deal_id = ${deal.id}`);
    const path = [...open.filter((s) => s.position <= finalOpen.position), ...(outcome === "open" ? [] : [stage])];
    const span = outcome === "open" ? Math.max(1, Math.min(age, 40)) : closeAfter;
    let prev: (typeof stages)[number] | null = null;
    for (const [step, s] of path.entries()) {
      await db().insert(schema.dealStageHistory).values({
        tenantId: t,
        dealId: deal.id,
        fromStageId: prev?.id ?? null,
        toStageId: s.id,
        fromStatus: prev ? "open" : null,
        toStatus: s.kind === "won" ? "won" : s.kind === "lost" ? "lost" : "open",
        changedBy: deal.ownerId,
        changedAt: at(created + (span * step * DAY) / Math.max(1, path.length - 1)),
      });
      prev = s;
    }
  }

  // Leads by source, about a third converted.
  const sources = ["website", "website", "whatsapp", "whatsapp", "referral", "campaign", "event", "manual"] as const;
  for (let i = 0; i < 70; i++) {
    const created = now - between(0, 150) * DAY - between(0, 20) * 3_600_000;
    const converted = rnd() < 0.35 && now - created > 3 * DAY;
    await db().insert(schema.leads).values({
      tenantId: t,
      fullName: `${pick(firstNames)} ${pick(lastNames)}`,
      source: pick([...sources]),
      status: converted ? "converted" : pick(["new", "new", "contacted", "qualified", "unqualified"]),
      ownerId: pick(users),
      createdAt: new Date(created),
      convertedAt: converted ? at(created + between(1, 12) * DAY) : null,
      aiClassification: rnd() < 0.5 ? pick(["hot", "warm", "warm", "cold", "spam"]) : null,
    });
  }

  // WhatsApp conversations (mock account — nothing is sent).
  const [wa] = await db()
    .insert(schema.whatsappAccounts)
    .values({ tenantId: t, provider: "mock", displayName: "כרם טויס", phoneNumber: "+972500000123", phoneNumberId: `demo_${t.slice(0, 8)}`, wabaId: "demo_waba" })
    .returning();
  for (const [i, contactId] of contactIds.slice(0, 10).entries()) {
    const [conv] = await db()
      .insert(schema.conversations)
      .values({ tenantId: t, whatsappAccountId: wa.id, contactId, assigneeId: i % 4 === 3 ? null : users[i % 3], unreadCount: i < 3 ? between(1, 4) : 0, status: i > 7 ? "closed" : "open" })
      .returning();
    let ts = now - between(1, 25) * DAY;
    let last = ts;
    let lastBody = "";
    for (let k = 0; k < 6; k++) {
      const inbound = k % 2 === 0;
      ts += inbound ? between(2, 30) * 3_600_000 : between(2, 95) * 60_000;
      if (ts > now) break;
      last = ts;
      lastBody = inbound ? pick(["שלום, יש לכם במלאי?", "מה המחיר לסיטונאי?", "אפשר משלוח עד יום חמישי?"]) : pick(["היי! כן, יש במלאי 🙂", "שולחת הצעת מחיר עכשיו", "בטח, נתאם משלוח"]);
      await db().insert(schema.messages).values({
        tenantId: t,
        conversationId: conv.id,
        direction: inbound ? "inbound" : "outbound",
        type: "text",
        body: lastBody,
        status: inbound ? "received" : "read",
        senderType: inbound ? "contact" : "user",
        senderUserId: inbound ? null : (conv.assigneeId ?? users[0]),
        createdAt: new Date(ts),
      });
    }
    await db().update(schema.conversations).set({ lastMessageAt: new Date(last), lastMessagePreview: lastBody || null }).where(sql`id = ${conv.id}`);
  }

  // Tasks: some done, some due today, some overdue.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  for (let i = 0; i < 18; i++) {
    const assignee = users[i % 3];
    const done = i % 3 === 0;
    await db().insert(schema.tasks).values({
      tenantId: t,
      title: pick(["לחזור ללקוח", "לשלוח הצעת מחיר", "לתאם פגישה", "בדיקת מלאי", "מעקב תשלום"]),
      assigneeId: assignee,
      contactId: pick(contactIds),
      priority: pick(["low", "medium", "medium", "high", "urgent"]),
      status: done ? "done" : "open",
      completedAt: done ? at(now - between(0, 28) * DAY) : null,
      completedBy: done ? assignee : null,
      dueAt: done ? null : new Date(dayStart.getTime() + between(-4, 6) * DAY + between(9, 17) * 3_600_000),
      createdBy: users[0],
    });
  }

  // Logged sales activities by the team.
  for (let i = 0; i < 45; i++) {
    await db().insert(schema.activities).values({
      tenantId: t,
      type: pick(["call", "call", "meeting", "email", "note"]),
      subject: pick(["שיחת מעקב", "פגישה בחנות", "שליחת קטלוג", "עדכון מחירים"]),
      contactId: pick(contactIds),
      actorId: pick(users),
      occurredAt: at(now - between(0, 60) * DAY - between(0, 10) * 3_600_000),
      durationMinutes: between(5, 60),
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
