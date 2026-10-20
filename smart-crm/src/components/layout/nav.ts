import type { Permission } from "@/server/rbac/permissions";

export type NavKey =
  | "dashboard"
  | "inbox"
  | "contacts"
  | "companies"
  | "leads"
  | "deals"
  | "tasks"
  | "calendar"
  | "documents"
  | "automations"
  | "analytics"
  | "copilot"
  | "settings";

export type NavItem = { key: NavKey; href: string; permission?: Permission; feature?: string };
export type NavGroup = { key: "workspace" | "sales" | "communication" | "insights"; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    key: "workspace",
    items: [
      { key: "dashboard", href: "/dashboard" },
      { key: "tasks", href: "/tasks", permission: "tasks.view" },
      { key: "calendar", href: "/calendar", permission: "calendar.view" },
    ],
  },
  {
    key: "communication",
    items: [
      { key: "inbox", href: "/inbox", permission: "inbox.view", feature: "whatsapp" },
      { key: "copilot", href: "/copilot", permission: "ai.use", feature: "ai" },
    ],
  },
  {
    key: "sales",
    items: [
      { key: "contacts", href: "/contacts", permission: "contacts.view" },
      { key: "companies", href: "/companies", permission: "companies.view" },
      { key: "leads", href: "/leads", permission: "leads.view" },
      { key: "deals", href: "/deals", permission: "deals.view" },
      { key: "documents", href: "/quotes", permission: "documents.view", feature: "documents" },
    ],
  },
  {
    key: "insights",
    items: [
      { key: "analytics", href: "/analytics", permission: "analytics.view", feature: "analytics" },
      { key: "automations", href: "/automations", permission: "automation.view", feature: "automation" },
    ],
  },
];
