import type { Rule } from "./definition";

/** Reads a dotted path from the run context (only plain data is ever stored there). */
export function readPath(ctx: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), ctx);
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function isEmpty(v: unknown) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

export function evaluateRule(rule: Rule, ctx: Record<string, unknown>): boolean {
  const actual = readPath(ctx, rule.field);
  const expected = rule.value;
  switch (rule.op) {
    case "eq":
      return String(actual ?? "") === String(expected ?? "");
    case "neq":
      return String(actual ?? "") !== String(expected ?? "");
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = num(actual);
      const b = num(expected);
      if (a === null || b === null) return false;
      return rule.op === "gt" ? a > b : rule.op === "gte" ? a >= b : rule.op === "lt" ? a < b : a <= b;
    }
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "not_contains":
      return !String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "in": {
      const list = Array.isArray(expected) ? expected.map(String) : String(expected ?? "").split(",").map((s) => s.trim());
      return list.includes(String(actual ?? ""));
    }
    case "is_empty":
      return isEmpty(actual);
    case "is_not_empty":
      return !isEmpty(actual);
    case "has_tag":
      return Array.isArray(actual) && actual.map(String).includes(String(expected));
    case "not_has_tag":
      return !(Array.isArray(actual) && actual.map(String).includes(String(expected)));
  }
}

export function evaluateRules(rules: Rule[], ctx: Record<string, unknown>, match: "all" | "any" = "all"): boolean {
  if (!rules.length) return true;
  return match === "all" ? rules.every((r) => evaluateRule(r, ctx)) : rules.some((r) => evaluateRule(r, ctx));
}

/** {{contact.firstName}}-style interpolation for message/task templates. */
export function interpolate(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const v = readPath(ctx, path);
    return v === undefined || v === null ? "" : String(v);
  });
}
