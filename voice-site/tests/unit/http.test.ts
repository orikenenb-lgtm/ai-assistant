import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, readBody } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";

function chunkedRequest(totalBytes: number): Request {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const chunk = new Uint8Array(Math.min(4096, totalBytes - sent)).fill(97);
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  // No Content-Length: the size is only known by reading.
  return new Request("http://x/api", { method: "POST", body: stream, duplex: "half", headers: { "content-type": "application/json" } } as RequestInit);
}

describe("readBody", () => {
  it("stops reading a chunked body past the cap", async () => {
    expect(await readBody(chunkedRequest(MAX_BODY_BYTES * 20))).toBeNull();
  });

  it("parses JSON and urlencoded bodies", async () => {
    const json = new Request("http://x", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "content-type": "application/json" } });
    expect(await readBody(json)).toEqual({ data: { a: 1 }, kind: "json" });
    const form = new Request("http://x", {
      method: "POST",
      body: "name=%D7%93%D7%A0%D7%99&phone=050",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(await readBody(form)).toEqual({ data: { name: "דני", phone: "050" }, kind: "form" });
  });
});

describe("rate limiting", () => {
  it("prefers platform IP headers and the proxy-appended X-Forwarded-For entry", () => {
    const h = (headers: Record<string, string>) => new Request("http://x", { headers });
    expect(clientIp(h({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "9.9.9.9" }))).toBe("1.1.1.1");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(h({}))).toBe("unknown");
  });

  it("flooding new keys does not reset existing limits", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) rateLimit("victim", 3, 60_000, now);
    expect(rateLimit("victim", 3, 60_000, now).ok).toBe(false);
    for (let i = 0; i < 12_000; i++) rateLimit(`flood-${i}`, 3, 60_000, now);
    // "victim" may be evicted as one of the oldest keys, but never by wiping
    // everything: recently active keys survive.
    for (let i = 0; i < 3; i++) rateLimit("recent", 3, 60_000, now);
    expect(rateLimit("recent", 3, 60_000, now).ok).toBe(false);
  });
});
