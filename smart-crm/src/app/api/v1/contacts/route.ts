import { z } from "zod";
import { apiRoute, json, queryObject, readBody } from "@/modules/api/framework";
import { apiCreateContact, apiListContacts } from "@/modules/api/resources";

export const GET = apiRoute({ scope: "contacts:read" }, async ({ ctx, request }) => json(await apiListContacts(ctx, queryObject(request))));

export const POST = apiRoute({ scope: "contacts:write" }, async ({ ctx, request }) =>
  json({ data: await apiCreateContact(ctx, await readBody(request, z.record(z.string(), z.unknown()))) }, 201),
);
