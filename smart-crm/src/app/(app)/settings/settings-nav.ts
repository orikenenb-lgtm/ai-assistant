import type { Permission } from "@/server/rbac/permissions";

/** Settings sections. Each module owns the page at /settings/<key>. */
export const SETTINGS_SECTIONS: { key: string; group: "org" | "crm" | "channels" | "developer" | "account"; permission?: Permission; feature?: string }[] = [
  { key: "general", group: "org", permission: "org.update" },
  { key: "team", group: "org", permission: "members.view" },
  { key: "billing", group: "org", permission: "billing.view" },
  { key: "notifications", group: "account" },
  { key: "pipelines", group: "crm", permission: "pipelines.manage" },
  { key: "custom-fields", group: "crm", permission: "settings.manage", feature: "custom_fields" },
  { key: "tags", group: "crm", permission: "settings.manage" },
  { key: "documents", group: "crm", permission: "documents.templates", feature: "documents" },
  { key: "whatsapp", group: "channels", permission: "integrations.manage", feature: "whatsapp" },
  { key: "integrations", group: "channels", permission: "integrations.manage" },
  { key: "api-keys", group: "developer", permission: "api_keys.manage", feature: "api" },
  { key: "webhooks", group: "developer", permission: "integrations.manage", feature: "webhooks" },
  { key: "privacy", group: "org", permission: "privacy.manage" },
  { key: "audit", group: "org", permission: "audit.view" },
];
