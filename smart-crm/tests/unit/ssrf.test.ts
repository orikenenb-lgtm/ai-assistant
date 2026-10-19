import { afterEach, describe, expect, it } from "vitest";
import { allowLoopbackWebhooksForTests, classifyAddress, resolvePublicTarget, validateWebhookUrl } from "@/modules/webhooks/ssrf";

describe("classifyAddress", () => {
  it.each([
    ["8.8.8.8", "public"],
    ["1.1.1.1", "public"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["172.32.0.1", "public"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "link-local"],
    ["100.64.0.1", "cgnat"],
    ["100.128.0.1", "public"],
    ["0.0.0.0", "unspecified"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
    ["198.18.0.1", "reserved"],
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fe80::1", "link-local"],
    ["fd12:3456::1", "private"],
    ["fc00::1", "private"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "reserved"],
    ["2606:4700:4700::1111", "public"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:169.254.169.254", "link-local"],
    ["::ffff:8.8.8.8", "public"],
    ["64:ff9b::10.0.0.1", "private"],
    ["not-an-ip", "invalid"],
  ])("%s → %s", (ip, cls) => {
    expect(classifyAddress(ip)).toBe(cls);
  });
});

describe("validateWebhookUrl", () => {
  afterEach(() => allowLoopbackWebhooksForTests(false));

  it("requires https and rejects credentials, private literals and internal names", () => {
    expect(validateWebhookUrl("https://hooks.example.com/x").ok).toBe(true);
    expect(validateWebhookUrl("http://hooks.example.com/x")).toEqual({ ok: false, reason: "https_required" });
    expect(validateWebhookUrl("https://user:pw@hooks.example.com")).toEqual({ ok: false, reason: "credentials_in_url" });
    expect(validateWebhookUrl("https://10.0.0.5/hook")).toEqual({ ok: false, reason: "private_address" });
    expect(validateWebhookUrl("https://[::1]/hook")).toEqual({ ok: false, reason: "private_address" });
    expect(validateWebhookUrl("https://169.254.169.254/latest/meta-data")).toEqual({ ok: false, reason: "private_address" });
    expect(validateWebhookUrl("https://localhost/hook")).toEqual({ ok: false, reason: "private_address" });
    expect(validateWebhookUrl("https://db.internal/hook")).toEqual({ ok: false, reason: "private_address" });
    expect(validateWebhookUrl("not a url")).toEqual({ ok: false, reason: "invalid_url" });
  });

  it("only allows the loopback test hook when APP_ENV=test", () => {
    allowLoopbackWebhooksForTests(true);
    expect(validateWebhookUrl("http://127.0.0.1:4000/hook").ok).toBe(true);
    const prev = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      expect(validateWebhookUrl("http://127.0.0.1:4000/hook").ok).toBe(false);
    } finally {
      process.env.APP_ENV = prev;
    }
  });
});

describe("resolvePublicTarget", () => {
  afterEach(() => allowLoopbackWebhooksForTests(false));

  it("rejects hostnames that resolve to loopback", async () => {
    await expect(resolvePublicTarget("localhost")).rejects.toThrow(/blocked destination/);
    await expect(resolvePublicTarget("127.0.0.1")).rejects.toThrow(/loopback/);
    await expect(resolvePublicTarget("[::1]")).rejects.toThrow(/loopback/);
  });

  it("returns literal public addresses unchanged", async () => {
    await expect(resolvePublicTarget("8.8.8.8")).resolves.toEqual({ address: "8.8.8.8", family: 4 });
  });
});
