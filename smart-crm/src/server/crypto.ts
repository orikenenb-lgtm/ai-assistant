import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/** 32-byte root key from ENCRYPTION_KEY. */
function rootKey(): Buffer {
  return Buffer.from(env().ENCRYPTION_KEY, "base64");
}

/** Purpose-bound subkey (HKDF-SHA256) so one secret never serves two uses. */
export function deriveKey(purpose: string, length = 32): Buffer {
  return Buffer.from(hkdfSync("sha256", rootKey(), Buffer.alloc(0), `smart-crm:${purpose}`, length));
}

const ENC_VERSION = "v1";

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url parts). */
export function encryptSecret(plaintext: string, aad = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("secrets"), iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, aad = ""): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== ENC_VERSION || !iv || !tag || ct === undefined) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey("secrets"), Buffer.from(iv, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(key: string | Buffer, data: string | Buffer): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

/** Constant-time comparison of two strings (false on length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** URL-safe random token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Short-lived signed token (HMAC-SHA256) carrying a small JSON payload, e.g. for
 * file download links. Format: <base64url(json)>.<base64url(sig)>
 */
export function signPayload(purpose: string, payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", deriveKey(`signed:${purpose}`)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T extends Record<string, unknown>>(purpose: string, token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", deriveKey(`signed:${purpose}`)).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}
