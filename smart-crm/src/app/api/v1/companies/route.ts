import { apiRoute, json, queryObject } from "@/modules/api/framework";
import { apiListCompanies } from "@/modules/api/resources";

export const GET = apiRoute({ scope: "companies:read" }, async ({ ctx, request }) => json(await apiListCompanies(ctx, queryObject(request))));
