import { z } from "zod";
import { apiRoute, json, parseId, readBody } from "@/modules/api/framework";
import { apiDeleteTask, apiGetTask, apiUpdateTask } from "@/modules/api/sales-resources";

type P = { id: string };

export const GET = apiRoute<P>({ scope: "tasks:read" }, async ({ ctx, params }) => json({ data: await apiGetTask(ctx, parseId(params.id)) }));

export const PATCH = apiRoute<P>({ scope: "tasks:write" }, async ({ ctx, params, request }) =>
  json({ data: await apiUpdateTask(ctx, parseId(params.id), await readBody(request, z.record(z.string(), z.unknown()))) }),
);

export const DELETE = apiRoute<P>({ scope: "tasks:write" }, async ({ ctx, params }) => {
  await apiDeleteTask(ctx, parseId(params.id));
  return new Response(null, { status: 204 });
});
