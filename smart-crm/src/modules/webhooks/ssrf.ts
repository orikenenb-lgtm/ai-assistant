import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF protection for outbound webhooks. Destinations must resolve only to
 * public unicast addresses; loopback, private, link-local (incl. the cloud
 * metadata endpoint 169.254.169.254), CGNAT, multicast and reserved ranges are
 * rejected. The resolved address is then pinned for the connection, so a DNS
 * answer cannot change between the check and the request (rebinding).
 */

export type AddressClass = "public" | "loopback" | "private" | "link-local" | "cgnat" | "multicast" | "reserved" | "unspecified" | "invalid";

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const V4_RANGES: [string, number, AddressClass][] = [
  ["0.0.0.0", 8, "unspecified"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "cgnat"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "reserved"],
  ["192.0.2.0", 24, "reserved"],
  ["192.88.99.0", 24, "reserved"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "reserved"],
  ["198.51.100.0", 24, "reserved"],
  ["203.0.113.0", 24, "reserved"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
];

function classifyV4(ip: string): AddressClass {
  const n = ipv4ToInt(ip);
  for (const [base, bits, cls] of V4_RANGES) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((n & mask) === (ipv4ToInt(base) & mask)) return cls;
  }
  return "public";
}

/** Expands an IPv6 address (incl. "::" and embedded IPv4) to 8 hextets. */
function expandV6(ip: string): number[] | null {
  let addr = ip.split("%")[0].toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    addr = addr.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = addr.split("::");
  const parse = (s: string) => (s ? s.split(":").map((h) => parseInt(h, 16)) : []);
  const h = parse(head);
  const t = tail === undefined ? [] : parse(tail);
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  const out = [...h, ...Array(fill).fill(0), ...t];
  if (out.length !== 8 || out.some((x) => !Number.isFinite(x) || x < 0 || x > 0xffff)) return null;
  return out;
}

function classifyV6(ip: string): AddressClass {
  const h = expandV6(ip);
  if (!h) return "invalid";
  if (h.every((x) => x === 0)) return "unspecified";
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return "loopback";
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible/NAT64 forms: classify the embedded IPv4.
  const embedded = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return classifyV4(embedded);
  if (h[0] === 0x64 && h[1] === 0xff9b) return classifyV4(embedded);
  if ((h[0] & 0xfe00) === 0xfc00) return "private"; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return "link-local"; // fe80::/10
  if ((h[0] & 0xffc0) === 0xfec0) return "private"; // fec0::/10 deprecated site-local
  if ((h[0] & 0xff00) === 0xff00) return "multicast";
  if (h[0] === 0x2001 && h[1] === 0x0db8) return "reserved"; // documentation
  if (h.slice(0, 6).every((x) => x === 0)) return "reserved"; // deprecated IPv4-compatible
  return "public";
}

export function classifyAddress(ip: string): AddressClass {
  const v = isIP(ip);
  if (v === 4) return classifyV4(ip);
  if (v === 6) return classifyV6(ip);
  return "invalid";
}

export const isPublicAddress = (ip: string) => classifyAddress(ip) === "public";

/* ----------------------------------------------------------- test hook */

let loopbackAllowedForTests = false;

/**
 * Lets the integration tests deliver to a local HTTP server. Only honored when
 * APP_ENV=test — it can never weaken production.
 */
export function allowLoopbackWebhooksForTests(allowed: boolean) {
  loopbackAllowedForTests = allowed;
}

export function loopbackAllowed(): boolean {
  return loopbackAllowedForTests && process.env.APP_ENV === "test";
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Static validation when a webhook is saved (DNS is re-checked at delivery). */
export function validateWebhookUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  const testLoopback = loopbackAllowed() && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (url.protocol !== "https:" && !testLoopback) return { ok: false, reason: "https_required" };
  if (url.username || url.password) return { ok: false, reason: "credentials_in_url" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicAddress(host) && !testLoopback) return { ok: false, reason: "private_address" };
  if (!testLoopback && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local"))) {
    return { ok: false, reason: "private_address" };
  }
  return { ok: true, url };
}

export type ResolvedTarget = { address: string; family: 4 | 6 };

/** Resolves a hostname and returns a public address to pin, or throws. */
export async function resolvePublicTarget(hostname: string): Promise<ResolvedTarget> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  const answers = literal ? [{ address: host, family: literal }] : await lookup(host, { all: true, verbatim: true });
  if (!answers.length) throw new Error("dns: no addresses");
  for (const a of answers) {
    const cls = classifyAddress(a.address);
    if (cls !== "public" && !(loopbackAllowed() && cls === "loopback")) {
      throw new Error(`blocked destination address (${cls})`);
    }
  }
  const first = answers[0];
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}
