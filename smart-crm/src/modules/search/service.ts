import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { schema } from "@/server/db";
import type { ServiceCtx } from "@/server/context";

export type SearchHit = { type: "contact" | "company" | "deal" | "lead"; id: string; title: string; subtitle: string | null; href: string };

/** Escapes LIKE wildcards so user input is matched literally. */
export function likePattern(q: string): string {
  return `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Tenant-scoped quick search across core CRM records (RLS-enforced for users). */
export async function globalSearch(ctx: ServiceCtx, q: string, perType = 5): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const pattern = likePattern(term);
  const digits = term.replace(/\D/g, "");
  return ctx.run(async (tx) => {
    const hits: SearchHit[] = [];
    if (ctx.can("contacts.view")) {
      const contacts = await tx
        .select({ id: schema.contacts.id, first: schema.contacts.firstName, last: schema.contacts.lastName, email: schema.contacts.email, phone: schema.contacts.phone })
        .from(schema.contacts)
        .where(
          and(
            eq(schema.contacts.tenantId, ctx.tenantId),
            isNull(schema.contacts.deletedAt),
            or(
              sql`${schema.contacts.searchText} like ${pattern}`,
              digits.length >= 4 ? sql`${schema.contacts.phone} like ${`%${digits}%`}` : sql`false`,
            ),
          ),
        )
        .orderBy(desc(schema.contacts.updatedAt))
        .limit(perType);
      for (const c of contacts) {
        hits.push({ type: "contact", id: c.id, title: `${c.first} ${c.last}`.trim() || c.email || c.phone || "—", subtitle: c.email ?? c.phone, href: `/contacts/${c.id}` });
      }
    }
    if (ctx.can("companies.view")) {
      const companies = await tx
        .select({ id: schema.companies.id, name: schema.companies.name, domain: schema.companies.domain })
        .from(schema.companies)
        .where(and(eq(schema.companies.tenantId, ctx.tenantId), isNull(schema.companies.deletedAt), sql`${schema.companies.searchText} like ${pattern}`))
        .limit(perType);
      for (const c of companies) hits.push({ type: "company", id: c.id, title: c.name, subtitle: c.domain, href: `/companies/${c.id}` });
    }
    if (ctx.can("deals.view")) {
      const deals = await tx
        .select({ id: schema.deals.id, title: schema.deals.title, status: schema.deals.status })
        .from(schema.deals)
        .where(and(eq(schema.deals.tenantId, ctx.tenantId), isNull(schema.deals.deletedAt), ilike(schema.deals.title, pattern)))
        .limit(perType);
      for (const d of deals) hits.push({ type: "deal", id: d.id, title: d.title, subtitle: d.status, href: `/deals/${d.id}` });
    }
    if (ctx.can("leads.view")) {
      const leads = await tx
        .select({ id: schema.leads.id, name: schema.leads.fullName, company: schema.leads.companyName, email: schema.leads.email })
        .from(schema.leads)
        .where(
          and(
            eq(schema.leads.tenantId, ctx.tenantId),
            isNull(schema.leads.deletedAt),
            or(ilike(schema.leads.fullName, pattern), ilike(schema.leads.companyName, pattern), ilike(schema.leads.email, pattern)),
          ),
        )
        .limit(perType);
      for (const l of leads) hits.push({ type: "lead", id: l.id, title: l.name || l.email || "—", subtitle: l.company, href: `/leads/${l.id}` });
    }
    return hits;
  });
}
