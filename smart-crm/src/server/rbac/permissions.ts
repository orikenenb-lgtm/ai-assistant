/**
 * Role → permission matrix. This file is the single place authorization rules
 * are defined; RLS in the database is the independent second wall.
 */
export const ROLES = ["owner", "manager", "agent"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "org.view",
  "org.update",
  "org.delete",
  "members.view",
  "members.invite",
  "members.manage",
  "billing.view",
  "billing.manage",
  "audit.view",
  "settings.manage",
  "integrations.manage",
  "api_keys.manage",
  "privacy.manage",
  "contacts.view",
  "contacts.create",
  "contacts.update",
  "contacts.delete",
  "contacts.import",
  "contacts.export",
  "contacts.merge",
  "companies.view",
  "companies.create",
  "companies.update",
  "companies.delete",
  "leads.view",
  "leads.create",
  "leads.update",
  "leads.delete",
  "leads.convert",
  "deals.view",
  "deals.create",
  "deals.update",
  "deals.delete",
  "pipelines.manage",
  "tasks.view",
  "tasks.create",
  "tasks.update",
  "tasks.delete",
  "tasks.assign_others",
  "calendar.view",
  "calendar.manage",
  "inbox.view",
  "inbox.reply",
  "inbox.assign",
  "inbox.templates",
  "inbox.consent",
  "ai.use",
  "ai.approve",
  "ai.usage",
  "automation.view",
  "automation.manage",
  "analytics.view",
  "analytics.export",
  "documents.view",
  "documents.create",
  "documents.update",
  "documents.delete",
  "documents.templates",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OWNER_ONLY: Permission[] = ["org.delete", "billing.manage", "api_keys.manage", "privacy.manage"];

const AGENT: Permission[] = [
  "org.view",
  "members.view",
  "contacts.view",
  "contacts.create",
  "contacts.update",
  "companies.view",
  "companies.create",
  "companies.update",
  "leads.view",
  "leads.create",
  "leads.update",
  "leads.convert",
  "deals.view",
  "deals.create",
  "deals.update",
  "tasks.view",
  "tasks.create",
  "tasks.update",
  "calendar.view",
  "calendar.manage",
  "inbox.view",
  "inbox.reply",
  "inbox.assign",
  "inbox.consent",
  "ai.use",
  "ai.approve",
  "analytics.view",
  "documents.view",
  "documents.create",
  "documents.update",
];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  manager: new Set(PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p))),
  agent: new Set(AGENT),
};

export function roleCan(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}

/** Which roles a given role may assign when inviting or changing members. */
export function assignableRoles(role: Role): Role[] {
  if (role === "owner") return ["owner", "manager", "agent"];
  if (role === "manager") return ["agent"];
  return [];
}

/** Whether `actor` may change or remove a member currently holding `target`. */
export function canManageMember(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "manager") return target === "agent";
  return false;
}
