import Papa from "papaparse";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { assertCanWrite, assertCan, type ServiceCtx } from "@/server/context";
import { audit } from "@/server/audit";
import { emitEvent } from "@/server/events";
import { AppError } from "@/server/errors";
import { normalizePhone } from "@/lib/phone";
import { getEntitlements } from "@/modules/billing/entitlements";
import { listCustomFields, validateCustomFields } from "../custom-fields";
import { LIFECYCLE_STAGES, type ListQuery } from "../schemas";
import { listContacts } from "./service";

export const IMPORT_FIELDS = [
  "firstName",
  "lastName",
  "fullName",
  "email",
  "phone",
  "title",
  "source",
  "lifecycleStage",
  "companyName",
  "tags",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number] | `custom:${string}`;

export const MAX_IMPORT_ROWS = 5000;

export const importOptionsSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  mapping: z.record(z.string(), z.string()),
  duplicateStrategy: z.enum(["skip", "update"]).default("skip"),
  createCompanies: z.boolean().default(true),
  consentOptIn: z.boolean().default(false),
  consentEvidence: z.string().trim().max(500).optional(),
});

export type ImportReport = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
};

/** Parses CSV text into header + rows (used for preview and import). */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return { headers: result.meta.fields ?? [], rows: result.data };
}

const STAGE_ALIASES: Record<string, (typeof LIFECYCLE_STAGES)[number]> = {
  lead: "lead",
  ליד: "lead",
  customer: "customer",
  לקוח: "customer",
  opportunity: "opportunity",
  הזדמנות: "opportunity",
  subscriber: "subscriber",
  מנוי: "subscriber",
  churned: "churned",
  נטש: "churned",
  other: "other",
  אחר: "other",
};

export async function importContacts(ctx: ServiceCtx, input: z.infer<typeof importOptionsSchema>): Promise<ImportReport> {
  assertCanWrite(ctx, "contacts.import");
  if (input.consentOptIn && !input.consentEvidence) {
    throw new AppError("VALIDATION", "errors.validation", { consentEvidence: ["validation.required"] });
  }
  const { rows } = parseCsv(input.csv);
  if (rows.length === 0) throw new AppError("VALIDATION", "import.empty");
  if (rows.length > MAX_IMPORT_ROWS) throw new AppError("VALIDATION", "import.tooManyRows");

  const fieldFor = new Map<string, ImportField>();
  for (const [column, field] of Object.entries(input.mapping)) if (field && field !== "ignore") fieldFor.set(column, field as ImportField);
  if (![...fieldFor.values()].some((f) => ["firstName", "lastName", "fullName", "email", "phone"].includes(f))) {
    throw new AppError("VALIDATION", "import.needIdentity");
  }

  const report: ImportReport = { total: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };

  await ctx.run(async (tx) => {
    const defs = await listCustomFields(tx, ctx.tenantId, "contact");
    const ent = await getEntitlements(tx, ctx.tenantId);
    const [{ existing }] = await tx.execute<{ existing: number }>(
      sql`select count(*)::int as existing from public.contacts where tenant_id = ${ctx.tenantId} and deleted_at is null`,
    );
    let capacity = (ent.limits.max_contacts ?? Number.MAX_SAFE_INTEGER) - Number(existing);

    const companyCache = new Map<string, string>();
    for (const c of await tx
      .select({ id: schema.companies.id, name: schema.companies.name })
      .from(schema.companies)
      .where(and(eq(schema.companies.tenantId, ctx.tenantId), isNull(schema.companies.deletedAt)))) {
      companyCache.set(c.name.trim().toLowerCase(), c.id);
    }
    const tagCache = new Map<string, string>();
    for (const t of await tx.select().from(schema.tags).where(eq(schema.tags.tenantId, ctx.tenantId))) tagCache.set(t.name.toLowerCase(), t.id);

    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2; // header is line 1
      const raw = rows[i];
      const v: Record<string, string> = {};
      const custom: Record<string, unknown> = {};
      for (const [col, field] of fieldFor) {
        const value = (raw[col] ?? "").trim();
        if (!value) continue;
        if (field.startsWith("custom:")) custom[field.slice(7)] = value;
        else v[field] = value;
      }
      let firstName = v.firstName ?? "";
      let lastName = v.lastName ?? "";
      if (!firstName && !lastName && v.fullName) {
        const parts = v.fullName.split(/\s+/);
        firstName = parts.shift() ?? "";
        lastName = parts.join(" ");
      }
      const email = v.email?.toLowerCase() || null;
      if (email && !z.email().safeParse(email).success) {
        report.errors.push({ row: rowNo, message: `email: ${email}` });
        continue;
      }
      let phone: string | null = null;
      if (v.phone) {
        phone = normalizePhone(v.phone);
        if (!phone) {
          report.errors.push({ row: rowNo, message: `phone: ${v.phone}` });
          continue;
        }
      }
      if (!firstName && !lastName && !email && !phone) {
        report.skipped++;
        continue;
      }
      let customFields: Record<string, unknown>;
      try {
        customFields = validateCustomFields(defs, custom, { partial: true });
      } catch {
        report.errors.push({ row: rowNo, message: "custom fields" });
        continue;
      }
      const stage = v.lifecycleStage ? STAGE_ALIASES[v.lifecycleStage.toLowerCase()] : undefined;

      let companyId: string | null = null;
      if (v.companyName) {
        const key = v.companyName.toLowerCase();
        companyId = companyCache.get(key) ?? null;
        if (!companyId && input.createCompanies) {
          const [co] = await tx
            .insert(schema.companies)
            .values({ tenantId: ctx.tenantId, name: v.companyName.slice(0, 200), createdBy: ctx.userId })
            .returning({ id: schema.companies.id });
          companyId = co.id;
          companyCache.set(key, co.id);
        }
      }

      const [dupe] = await tx
        .select()
        .from(schema.contacts)
        .where(
          and(
            eq(schema.contacts.tenantId, ctx.tenantId),
            isNull(schema.contacts.deletedAt),
            sql`(${email ? sql`lower(${schema.contacts.email}) = ${email}` : sql`false`} or ${phone ? sql`${schema.contacts.phone} = ${phone}` : sql`false`})`,
          ),
        )
        .limit(1);

      let contactId: string;
      if (dupe) {
        if (input.duplicateStrategy === "skip") {
          report.skipped++;
          continue;
        }
        await tx
          .update(schema.contacts)
          .set({
            firstName: firstName || dupe.firstName,
            lastName: lastName || dupe.lastName,
            email: email ?? dupe.email,
            phone: phone ?? dupe.phone,
            title: v.title ?? dupe.title,
            source: v.source ?? dupe.source,
            lifecycleStage: stage ?? dupe.lifecycleStage,
            companyId: companyId ?? dupe.companyId,
            customFields: { ...dupe.customFields, ...customFields },
          })
          .where(eq(schema.contacts.id, dupe.id));
        contactId = dupe.id;
        report.updated++;
      } else {
        if (capacity <= 0) {
          report.errors.push({ row: rowNo, message: "plan contact limit reached" });
          continue;
        }
        const [c] = await tx
          .insert(schema.contacts)
          .values({
            tenantId: ctx.tenantId,
            firstName,
            lastName,
            email,
            phone,
            title: v.title ?? null,
            source: v.source ?? "import",
            lifecycleStage: stage ?? "lead",
            companyId,
            ownerId: ctx.actorType === "user" ? ctx.userId : null,
            customFields,
            createdBy: ctx.userId,
          })
          .returning({ id: schema.contacts.id });
        contactId = c.id;
        capacity--;
        report.created++;
        await emitEvent(tx, ctx, { type: "contact.created", entityType: "contact", entityId: c.id, data: { source: "import" } });
      }

      if (v.tags) {
        for (const name of v.tags.split(/[,;|]/).map((s) => s.trim()).filter(Boolean).slice(0, 20)) {
          let tagId = tagCache.get(name.toLowerCase());
          if (!tagId) {
            const [t] = await tx.insert(schema.tags).values({ tenantId: ctx.tenantId, name: name.slice(0, 40) }).returning({ id: schema.tags.id });
            tagId = t.id;
            tagCache.set(name.toLowerCase(), tagId);
          }
          await tx.insert(schema.contactTags).values({ tenantId: ctx.tenantId, contactId, tagId }).onConflictDoNothing();
        }
      }
      if (input.consentOptIn && phone) {
        await tx.execute(sql`
          update public.contacts set whatsapp_consent = 'opted_in', consent_updated_at = now()
          where id = ${contactId} and whatsapp_consent = 'unknown'`);
        await tx.insert(schema.contactConsents).values({
          tenantId: ctx.tenantId,
          contactId,
          status: "opted_in",
          source: "import",
          evidence: input.consentEvidence ?? null,
          recordedBy: ctx.userId,
        });
      }
    }
    await audit(tx, ctx, {
      action: "contacts.imported",
      entityType: "contact",
      metadata: { total: report.total, created: report.created, updated: report.updated, skipped: report.skipped, errors: report.errors.length },
    });
  });

  if (report.created > 0) {
    await db().insert(schema.usageEvents).values({ tenantId: ctx.tenantId, metric: "contacts_imported", quantity: report.created });
  }
  return report;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = Array.isArray(v) ? v.join(", ") : v instanceof Date ? v.toISOString() : String(v);
  // Neutralize spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV (UTF-8 with BOM so Excel shows Hebrew correctly) of the filtered contact list. */
export async function exportContactsCsv(ctx: ServiceCtx, filters: ListQuery): Promise<{ csv: string; count: number }> {
  assertCan(ctx, "contacts.export");
  const defs = await ctx.run((tx) => listCustomFields(tx, ctx.tenantId, "contact"));
  const header = ["first_name", "last_name", "email", "phone", "lifecycle_stage", "whatsapp_consent", "company", "owner", "tags", "created_at", ...defs.map((d) => d.key)];
  const lines = [header.join(",")];
  let page = 1;
  let exported = 0;
  const MAX = 50_000;
  for (;;) {
    const { rows } = await listContacts(ctx, { ...filters, page, pageSize: 100 });
    if (!rows.length) break;
    const custom = await ctx.run(async (tx) => {
      const full = await tx
        .select({ id: schema.contacts.id, customFields: schema.contacts.customFields })
        .from(schema.contacts)
        .where(inArray(schema.contacts.id, rows.map((r) => r.id)));
      return new Map(full.map((f) => [f.id, f.customFields]));
    });
    for (const r of rows) {
      const cf = custom.get(r.id) ?? {};
      lines.push(
        [r.firstName, r.lastName, r.email, r.phone, r.lifecycleStage, r.whatsappConsent, r.companyName, r.ownerName, r.tags.map((t) => t.name), r.createdAt, ...defs.map((d) => cf[d.key])]
          .map(csvCell)
          .join(","),
      );
    }
    exported += rows.length;
    if (rows.length < 100 || exported >= MAX) break;
    page++;
  }
  await ctx.run((tx) => audit(tx, ctx, { action: "contacts.exported", entityType: "contact", metadata: { count: exported, filters } }));
  return { csv: `﻿${lines.join("\r\n")}\r\n`, count: exported };
}

