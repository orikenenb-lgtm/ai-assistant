/**
 * MOCK WhatsApp provider — LOCAL DEVELOPMENT AND TESTS ONLY.
 * Never contacts Meta. Records "sent" messages in memory and returns fake
 * message ids. Recipients whose number ends in 0000 simulate an undeliverable
 * number (Meta error 131026) so failure handling can be exercised.
 */
import { randomUUID } from "node:crypto";
import {
  WhatsAppProviderError,
  type ConnectionCheck,
  type MediaKind,
  type OutboundTemplate,
  type ProviderTemplate,
  type WhatsAppProvider,
} from "./provider";

export type MockSent = { to: string; type: "text" | "template" | MediaKind; body?: string; template?: OutboundTemplate; fileName?: string; waMessageId: string };

/** In-memory log of everything the mock "sent" (inspected by tests). */
export const mockOutbox: MockSent[] = [];

export const MOCK_TEMPLATES: ProviderTemplate[] = [
  {
    metaTemplateId: "mock_tpl_welcome",
    name: "welcome_message",
    language: "he",
    category: "UTILITY",
    status: "APPROVED",
    components: [{ type: "BODY", text: "שלום {{1}}, תודה שפנית אלינו! איך נוכל לעזור?" }],
    rejectedReason: null,
  },
  {
    metaTemplateId: "mock_tpl_order",
    name: "order_ready",
    language: "he",
    category: "UTILITY",
    status: "APPROVED",
    components: [
      { type: "HEADER", format: "TEXT", text: "עדכון הזמנה" },
      { type: "BODY", text: "היי {{1}}, ההזמנה שלך מספר {{2}} מוכנה לאיסוף." },
      { type: "FOOTER", text: "SMART CRM AI" },
    ],
    rejectedReason: null,
  },
  {
    metaTemplateId: "mock_tpl_promo",
    name: "seasonal_promo",
    language: "he",
    category: "MARKETING",
    status: "PENDING",
    components: [{ type: "BODY", text: "מבצע החגים מתחיל! {{1}} הנחה על כל הקטלוג." }],
    rejectedReason: null,
  },
  {
    metaTemplateId: "mock_tpl_hello",
    name: "hello_world",
    language: "en_US",
    category: "UTILITY",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Hello {{1}}, thanks for reaching out!" }],
    rejectedReason: null,
  },
];

function failIfUndeliverable(to: string) {
  if (to.endsWith("0000")) throw new WhatsAppProviderError("Message undeliverable (mock)", "permanent", "131026", 400);
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly kind = "mock" as const;

  private record(entry: Omit<MockSent, "waMessageId">) {
    failIfUndeliverable(entry.to);
    const waMessageId = `wamid.MOCK.${randomUUID()}`;
    mockOutbox.push({ ...entry, waMessageId });
    return { waMessageId };
  }

  async sendText(to: string, body: string) {
    return this.record({ to, type: "text", body });
  }

  async sendTemplate(to: string, template: OutboundTemplate) {
    return this.record({ to, type: "template", template });
  }

  async sendMedia(to: string, media: { kind: MediaKind; bytes: Buffer; mimeType: string; fileName: string; caption?: string | null }) {
    return this.record({ to, type: media.kind, fileName: media.fileName, body: media.caption ?? undefined });
  }

  async markRead() {}

  async fetchTemplates() {
    return MOCK_TEMPLATES;
  }

  async downloadMedia(mediaId: string) {
    // A 1×1 PNG so inbound "images" render in development.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    return { bytes: mediaId.startsWith("doc") ? Buffer.from("%PDF-1.4\n% mock\n") : png, mimeType: mediaId.startsWith("doc") ? "application/pdf" : "image/png" };
  }

  async testConnection(): Promise<ConnectionCheck> {
    return { ok: true, displayPhoneNumber: "MOCK", verifiedName: "Mock account (development)", qualityRating: "GREEN" };
  }
}
