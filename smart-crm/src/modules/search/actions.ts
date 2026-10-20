"use server";

import { z } from "zod";
import { tenantAction, type ActionResult } from "@/server/action";
import { globalSearch, type SearchHit } from "./service";

export async function globalSearchAction(input: unknown): Promise<ActionResult<SearchHit[]>> {
  return tenantAction(input, { schema: z.object({ q: z.string().max(100) }), write: false }, ({ q }, { ctx }) => globalSearch(ctx, q));
}
