import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { API_SCOPES } from "@/modules/api/keys";

const root = join(__dirname, "..", "..");
const v1Dir = join(root, "src", "app", "api", "v1");
const spec = JSON.parse(readFileSync(join(root, "docs", "openapi.json"), "utf8")) as {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: { Scope: { enum: string[] } } };
};

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

/** `contacts/[id]/route.ts` → `/contacts/{id}` and its exported HTTP methods. */
const implemented = routeFiles(v1Dir).map((file) => {
  const rel = relative(v1Dir, file).split(sep).slice(0, -1).join("/");
  const path = `/${rel}`.replace(/\[([^\]]+)\]/g, "{$1}");
  const methods = [...readFileSync(file, "utf8").matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1].toLowerCase());
  return { path, methods };
});

describe("OpenAPI document matches the v1 route handlers", () => {
  it("is OpenAPI 3.1", () => {
    expect(spec.openapi).toBe("3.1.0");
  });

  it("documents every implemented operation", () => {
    for (const r of implemented) {
      expect(spec.paths[r.path], `missing path ${r.path}`).toBeDefined();
      for (const m of r.methods) expect(spec.paths[r.path][m], `missing ${m.toUpperCase()} ${r.path}`).toBeDefined();
    }
  });

  it("documents nothing that isn't implemented", () => {
    for (const [path, ops] of Object.entries(spec.paths)) {
      const route = implemented.find((r) => r.path === path);
      expect(route, `documented but not implemented: ${path}`).toBeDefined();
      for (const m of Object.keys(ops).filter((k) => k !== "parameters")) {
        expect(route!.methods, `documented but not implemented: ${m.toUpperCase()} ${path}`).toContain(m);
      }
    }
  });

  it("lists exactly the scopes the server accepts", () => {
    expect([...spec.components.schemas.Scope.enum].sort()).toEqual([...API_SCOPES].sort());
  });
});
