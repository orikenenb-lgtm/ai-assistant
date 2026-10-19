import { z } from "zod";
import { apiRoute, json, parseId, readBody } from "@/modules/api/framework";
import { apiDeleteDeal, apiGetDeal, apiUpdateDeal } from "@/modules/api/sales-resources";

type P = { id: string };

export const GET = apiRoute<P>({ scope: "deals:read" }, async ({ ctx, params }) => json({ data: await apiGetDeal(ctx, parseId(params.id)) }));

export const PATCH = apiRoute<P>({ scope: "deals:write" }, async ({ ctx, params, request }) =>
  json({ data: await apiUpdateDeal(ctx, parseId(params.id), await readBody(request, z.record(z.string(), z.unknown()))) }),
);

export const DELETE = apiRoute<P>({ scope: "deals:write" }, async ({ ctx, params }) => {
  await apiDeleteDeal(ctx, parseId(params.id));
  return new Response(null, { status: 204 });
});
