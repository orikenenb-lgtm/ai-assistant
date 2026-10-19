import { z } from "zod";
import { apiRoute, json, parseId, readBody } from "@/modules/api/framework";
import { apiDeleteContact, apiGetContact, apiUpdateContact } from "@/modules/api/resources";

type P = { id: string };

export const GET = apiRoute<P>({ scope: "contacts:read" }, async ({ ctx, params }) => json({ data: await apiGetContact(ctx, parseId(params.id)) }));

export const PATCH = apiRoute<P>({ scope: "contacts:write" }, async ({ ctx, params, request }) =>
  json({ data: await apiUpdateContact(ctx, parseId(params.id), await readBody(request, z.record(z.string(), z.unknown()))) }),
);

export const DELETE = apiRoute<P>({ scope: "contacts:write" }, async ({ ctx, params }) => {
  await apiDeleteContact(ctx, parseId(params.id));
  return new Response(null, { status: 204 });
});
