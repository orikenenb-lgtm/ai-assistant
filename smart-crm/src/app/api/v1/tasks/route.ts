import { z } from "zod";
import { apiRoute, json, queryObject, readBody } from "@/modules/api/framework";
import { apiCreateTask, apiListTasks } from "@/modules/api/sales-resources";

export const GET = apiRoute({ scope: "tasks:read" }, async ({ ctx, request }) => json(await apiListTasks(ctx, queryObject(request))));

export const POST = apiRoute({ scope: "tasks:write" }, async ({ ctx, request }) =>
  json({ data: await apiCreateTask(ctx, await readBody(request, z.record(z.string(), z.unknown()))) }, 201),
);
