import { describe, expect, it } from "vitest";
import { safeNext } from "@/modules/auth/schemas";
import { clientIp } from "@/server/request-ip";
import { classifyAddress } from "@/modules/webhooks/ssrf";
import { companyInputSchema } from "@/modules/crm/schemas";
import { isValidTimeZone } from "@/lib/timezone";

describe("safeNext (open redirects)", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/contacts?q=1#top")).toBe("/contacts?q=1#top");
    expect(safeNext("/deals/123")).toBe("/deals/123");
  });
  it.each(["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "", null])("rejects %j", (next) => {
    expect(safeNext(next as string | null, "/dashboard")).toBe("/dashboard");
  });
});

describe("clientIp", () => {
  it("prefers Vercel's header, then the right-most forwarded hop", () => {
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "6.6.6.6, 2.2.2.2" }))).toBe("1.1.1.1");
    // A client-supplied left-most value is ignored.
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe("SSRF classifier (IPv6 tunnels and SIIT)", () => {
  it.each([
    ["::ffff:0:a9fe:a9fe", "link-local"], // SIIT 169.254.169.254
    ["::ffff:0:7f00:1", "loopback"],
    ["2002:7f00:1::1", "reserved"], // 6to4
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "reserved"], // Teredo
  ])("%s → %s", (ip, cls) => {
    expect(classifyAddress(ip)).toBe(cls);
  });
  it("still treats ordinary global IPv6 as public", () => {
    expect(classifyAddress("2606:4700:4700::1111")).toBe("public");
  });
});

describe("company website", () => {
  const parse = (website: string) => companyInputSchema.safeParse({ name: "Acme", website });
  it("normalizes bare domains to https and keeps http(s) URLs", () => {
    expect(parse("example.co.il").data?.website).toBe("https://example.co.il/");
    expect(parse("http://kerem.example/shop").data?.website).toBe("http://kerem.example/shop");
  });
  it("rejects other schemes", () => {
    expect(parse("javascript:alert(1)").success).toBe(false);
    expect(parse("data:text/html,x").success).toBe(false);
  });
});

describe("time zones", () => {
  it("accepts IANA zones only", () => {
    expect(isValidTimeZone("Asia/Jerusalem")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
