import { env } from "@/server/env";
import {
  classifyMetaError,
  WhatsAppProviderError,
  type ConnectionCheck,
  type MediaKind,
  type OutboundTemplate,
  type ProviderTemplate,
  type WhatsAppProvider,
} from "./provider";

const TIMEOUT_MS = 15_000;

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } } };

/** Official Meta WhatsApp Cloud API (Graph API). */
export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  readonly kind = "meta" as const;

  constructor(
    private readonly account: { phoneNumberId: string; wabaId: string },
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private base() {
    return `https://graph.facebook.com/${env().META_GRAPH_VERSION}`;
  }

  private async request<T>(path: string, init: RequestInit & { raw?: false } = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(path.startsWith("http") ? path : `${this.base()}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.accessToken}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new WhatsAppProviderError(`network error: ${e instanceof Error ? e.message : String(e)}`, "retryable", null, 0);
    }
    const body = (await res.json().catch(() => ({}))) as T & GraphError;
    if (!res.ok || body.error) {
      const code = body.error?.code !== undefined ? String(body.error.code) : null;
      const detail = body.error?.error_data?.details ?? body.error?.message ?? `HTTP ${res.status}`;
      throw new WhatsAppProviderError(detail.slice(0, 500), classifyMetaError(res.status, code), code, res.status);
    }
    return body;
  }

  private async postMessage(payload: Record<string, unknown>): Promise<{ waMessageId: string }> {
    const body = await this.request<{ messages?: { id: string }[] }>(`/${this.account.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    });
    const id = body.messages?.[0]?.id;
    if (!id) throw new WhatsAppProviderError("Meta response did not include a message id", "retryable");
    return { waMessageId: id };
  }

  sendText(to: string, text: string) {
    return this.postMessage({ to, type: "text", text: { body: text, preview_url: /https?:\/\//.test(text) } });
  }

  sendTemplate(to: string, template: OutboundTemplate) {
    return this.postMessage({
      to,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        components: template.components.filter((c) => c.parameters.length > 0),
      },
    });
  }

  async sendMedia(to: string, media: { kind: MediaKind; bytes: Buffer; mimeType: string; fileName: string; caption?: string | null }) {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", media.mimeType);
    form.set("file", new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }), media.fileName);
    const uploaded = await this.request<{ id?: string }>(`/${this.account.phoneNumberId}/media`, { method: "POST", body: form });
    if (!uploaded.id) throw new WhatsAppProviderError("media upload returned no id", "retryable");
    const object: Record<string, unknown> = { id: uploaded.id };
    if (media.caption && media.kind !== "audio") object.caption = media.caption;
    if (media.kind === "document") object.filename = media.fileName;
    return this.postMessage({ to, type: media.kind, [media.kind]: object });
  }

  async markRead(waMessageId: string) {
    await this.request(`/${this.account.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: waMessageId }),
    });
  }

  async fetchTemplates(): Promise<ProviderTemplate[]> {
    const out: ProviderTemplate[] = [];
    let next: string | null = `/${this.account.wabaId}/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=100`;
    for (let page = 0; next && page < 20; page++) {
      const body: {
        data?: { id: string; name: string; language: string; status: string; category: string; components?: unknown[]; rejected_reason?: string }[];
        paging?: { next?: string };
      } = await this.request(next);
      for (const t of body.data ?? []) {
        out.push({
          metaTemplateId: t.id,
          name: t.name,
          language: t.language,
          category: (["MARKETING", "UTILITY", "AUTHENTICATION"].includes(t.category) ? t.category : "UTILITY") as ProviderTemplate["category"],
          status: (["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED", "IN_APPEAL"].includes(t.status) ? t.status : "PENDING") as ProviderTemplate["status"],
          components: t.components ?? [],
          rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
        });
      }
      next = body.paging?.next ?? null;
    }
    return out;
  }

  async downloadMedia(mediaId: string) {
    const meta = await this.request<{ url?: string; mime_type?: string }>(`/${mediaId}`);
    if (!meta.url) throw new WhatsAppProviderError("media url missing", "retryable");
    let res: Response;
    try {
      res = await this.fetchImpl(meta.url, { headers: { Authorization: `Bearer ${this.accessToken}` }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new WhatsAppProviderError(`media download failed: ${e instanceof Error ? e.message : e}`, "retryable");
    }
    if (!res.ok) throw new WhatsAppProviderError(`media download HTTP ${res.status}`, classifyMetaError(res.status, null), null, res.status);
    return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: meta.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream" };
  }

  async verifyOwnership(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const body = await this.request<{ data?: { id: string }[] }>(`/${this.account.wabaId}/phone_numbers?fields=id&limit=100`);
      return (body.data ?? []).some((n) => n.id === this.account.phoneNumberId) ? { ok: true } : { ok: false, reason: "phone number is not part of this WhatsApp Business Account" };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  async testConnection(): Promise<ConnectionCheck> {
    try {
      const body = await this.request<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>(
        `/${this.account.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      );
      return { ok: true, displayPhoneNumber: body.display_phone_number ?? null, verifiedName: body.verified_name ?? null, qualityRating: body.quality_rating ?? null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
