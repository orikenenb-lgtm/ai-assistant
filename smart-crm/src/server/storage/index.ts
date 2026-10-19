import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";
import { signPayload } from "../crypto";
import { AppError } from "../errors";

export interface StorageProvider {
  readonly kind: "local" | "supabase";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Short-lived URL that downloads the object as an attachment. */
  signedUrl(key: string, ttlSeconds: number, downloadName: string): Promise<string>;
}

/** Development storage on local disk. Downloads go through /api/files/raw with an HMAC-signed token. */
class LocalDiskStorage implements StorageProvider {
  readonly kind = "local" as const;
  constructor(private readonly dir: string) {}
  private resolve(key: string) {
    const full = path.resolve(this.dir, key);
    if (!full.startsWith(path.resolve(this.dir) + path.sep)) throw new Error("invalid storage key");
    return full;
  }
  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
  async signedUrl(key: string, ttlSeconds: number, downloadName: string) {
    const token = signPayload("file-download", { key, name: downloadName }, ttlSeconds);
    return `/api/files/raw?token=${encodeURIComponent(token)}`;
  }
}

class SupabaseStorage implements StorageProvider {
  readonly kind = "supabase" as const;
  private client: SupabaseClient;
  constructor(
    url: string,
    serviceKey: string,
    private readonly bucket: string,
  ) {
    this.client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  async put(key: string, body: Buffer, contentType: string) {
    const { error } = await this.client.storage.from(this.bucket).upload(key, body, { contentType, upsert: false });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
  }
  async get(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`storage download failed: ${error?.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  async delete(key: string) {
    await this.client.storage.from(this.bucket).remove([key]);
  }
  async signedUrl(key: string, ttlSeconds: number, downloadName: string) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(key, ttlSeconds, { download: downloadName });
    if (error || !data) throw new Error(`signed url failed: ${error?.message}`);
    return data.signedUrl;
  }
}

let provider: StorageProvider | undefined;
export function storage(): StorageProvider {
  if (!provider) {
    const e = env();
    provider =
      e.STORAGE_PROVIDER === "supabase"
        ? new SupabaseStorage(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, e.SUPABASE_STORAGE_BUCKET)
        : new LocalDiskStorage(path.resolve(e.LOCAL_STORAGE_DIR));
  }
  return provider;
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "application/zip": [".zip"],
  "audio/ogg": [".ogg", ".opus"],
  "audio/mpeg": [".mp3"],
  "video/mp4": [".mp4"],
};

/** Strips path components and control characters; keeps Unicode (Hebrew) names. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "_").trim().slice(0, 200);
  return cleaned || "file";
}

export function validateUpload(file: { name: string; type: string; size: number }) {
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", "files.tooLarge");
  const ext = path.extname(file.name).toLowerCase();
  const allowed = ALLOWED_TYPES[file.type];
  if (!allowed || !allowed.includes(ext)) throw new AppError("VALIDATION", "files.typeNotAllowed");
}

export function storageKey(tenantId: string, area: string, fileName: string): string {
  return `${tenantId}/${area}/${randomUUID()}/${sanitizeFileName(fileName).replace(/\s+/g, "_")}`;
}
