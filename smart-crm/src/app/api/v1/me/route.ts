import { apiRoute, json } from "@/modules/api/framework";

/** Information about the calling API key. */
export const GET = apiRoute({}, async ({ principal }) =>
  json({
    data: { keyId: principal.keyId, name: principal.name, prefix: principal.prefix, scopes: principal.scopes, organizationId: principal.tenantId },
  }),
);
