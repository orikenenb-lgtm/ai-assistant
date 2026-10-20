"use server";

import { z } from "zod";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { tenantAction, type ActionResult } from "@/server/action";
import { schema } from "@/server/db";
import { likePattern } from "@/modules/search/service";
import { searchCompanyOptions, type CompanyOption } from "./companies/lookup";
import { contactDisplayName } from "./contacts/service";

const q = z.object({ q: z.string().max(100).default("") });

export async function searchCompaniesAction(input: unknown): Promise<ActionResult<CompanyOption[]>> {
  return tenantAction(input, { schema: q, write: false }, ({ q }, { ctx }) => searchCompanyOptions(ctx, q));
}

export async function searchContactsAction(input: unknown): Promise<ActionResult<{ id: string; name: string }[]>> {
  return tenantAction(input, { schema: q, permission: "contacts.view", write: false }, ({ q }, { ctx }) =>
    ctx.run(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.contacts)
        .where(
          and(
            eq(schema.contacts.tenantId, ctx.tenantId),
            isNull(schema.contacts.deletedAt),
            q.trim()
              ? or(sql`${schema.contacts.searchText} like ${likePattern(q.trim())}`, sql`${schema.contacts.phone} like ${`%${q.replace(/\D/g, "") || "~"}%`}`)
              : undefined,
          ),
        )
        .orderBy(asc(schema.contacts.firstName))
        .limit(10);
      return rows.map((c) => ({ id: c.id, name: contactDisplayName(c) }));
    }),
  );
}

export async function searchDealsAction(input: unknown): Promise<ActionResult<{ id: string; name: string }[]>> {
  return tenantAction(input, { schema: q, permission: "deals.view", write: false }, ({ q }, { ctx }) =>
    ctx.run(async (tx) => {
      const rows = await tx
        .select({ id: schema.deals.id, name: schema.deals.title })
        .from(schema.deals)
        .where(
          and(
            eq(schema.deals.tenantId, ctx.tenantId),
            isNull(schema.deals.deletedAt),
            q.trim() ? sql`lower(${schema.deals.title}) like ${likePattern(q.trim())}` : undefined,
          ),
        )
        .orderBy(asc(schema.deals.title))
        .limit(10);
      return rows;
    }),
  );
}

export async function searchLeadsAction(input: unknown): Promise<ActionResult<{ id: string; name: string }[]>> {
  return tenantAction(input, { schema: q, permission: "leads.view", write: false }, ({ q }, { ctx }) =>
    ctx.run(async (tx) => {
      const pattern = likePattern(q.trim());
      const rows = await tx
        .select({ id: schema.leads.id, fullName: schema.leads.fullName, email: schema.leads.email, phone: schema.leads.phone, company: schema.leads.companyName })
        .from(schema.leads)
        .where(
          and(
            eq(schema.leads.tenantId, ctx.tenantId),
            isNull(schema.leads.deletedAt),
            q.trim()
              ? or(
                  sql`lower(${schema.leads.fullName}) like ${pattern}`,
                  sql`lower(coalesce(${schema.leads.email}, '')) like ${pattern}`,
                  sql`lower(coalesce(${schema.leads.companyName}, '')) like ${pattern}`,
                )
              : undefined,
          ),
        )
        .orderBy(asc(schema.leads.fullName))
        .limit(10);
      return rows.map((l) => ({ id: l.id, name: l.fullName || l.email || l.phone || l.company || "—" }));
    }),
  );
}
