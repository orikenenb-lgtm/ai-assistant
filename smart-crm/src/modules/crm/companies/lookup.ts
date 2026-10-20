import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@/server/db";
import { assertCan, type ServiceCtx } from "@/server/context";
import { likePattern } from "@/modules/search/service";

export type CompanyOption = { id: string; name: string };

/** Typeahead lookup used by pickers in other modules. */
export async function searchCompanyOptions(ctx: ServiceCtx, q: string, limit = 10): Promise<CompanyOption[]> {
  assertCan(ctx, "companies.view");
  return ctx.run((tx) =>
    tx
      .select({ id: schema.companies.id, name: schema.companies.name })
      .from(schema.companies)
      .where(
        and(
          eq(schema.companies.tenantId, ctx.tenantId),
          isNull(schema.companies.deletedAt),
          q.trim() ? sql`${schema.companies.searchText} like ${likePattern(q.trim())}` : undefined,
        ),
      )
      .orderBy(asc(schema.companies.name))
      .limit(limit),
  );
}
