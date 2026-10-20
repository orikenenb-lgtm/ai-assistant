import { z } from "zod";
import { apiRoute, json, queryObject, readBody } from "@/modules/api/framework";
import { apiCreateDeal, apiListDeals } from "@/modules/api/sales-resources";

export const GET = apiRoute({ scope: "deals:read" }, async ({ ctx, request }) => json(await apiListDeals(ctx, queryObject(request))));

export const POST = apiRoute({ scope: "deals:write" }, async ({ ctx, request }) =>
  json({ data: await apiCreateDeal(ctx, await readBody(request, z.record(z.string(), z.unknown()))) }, 201),
);
