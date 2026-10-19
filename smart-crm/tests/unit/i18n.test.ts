import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve(import.meta.dirname, "../../messages");

function keys(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}

describe("message catalogs", () => {
  const namespaces = readdirSync(path.join(dir, "he")).filter((f) => f.endsWith(".json"));

  it("has the same namespace files for he and en", () => {
    expect(readdirSync(path.join(dir, "en")).filter((f) => f.endsWith(".json")).sort()).toEqual(namespaces.sort());
  });

  for (const file of namespaces) {
    it(`${file}: identical keys and placeholders in he and en`, () => {
      const he = JSON.parse(readFileSync(path.join(dir, "he", file), "utf8"));
      const en = JSON.parse(readFileSync(path.join(dir, "en", file), "utf8"));
      expect(keys(en).sort()).toEqual(keys(he).sort());
      for (const k of keys(he)) {
        const get = (o: Record<string, unknown>) => k.split(".").reduce<unknown>((a, p) => (a as Record<string, unknown>)[p], o) as string;
        expect(placeholders(get(en)), `${file}:${k}`).toEqual(placeholders(get(he)));
      }
    });
  }

  it("the generated index lists every namespace", () => {
    const index = readFileSync(path.resolve(import.meta.dirname, "../../src/i18n/messages.generated.ts"), "utf8");
    for (const file of namespaces) expect(index).toContain(`/he/${file}`);
  });
});
