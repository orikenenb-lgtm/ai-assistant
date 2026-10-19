import { apiRoute, json, parseId } from "@/modules/api/framework";
import { apiGetCompany } from "@/modules/api/resources";

export const GET = apiRoute<{ id: string }>({ scope: "companies:read" }, async ({ ctx, params }) =>
  json({ data: await apiGetCompany(ctx, parseId(params.id)) }),
);
