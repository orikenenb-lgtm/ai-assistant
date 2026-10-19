/**
 * WhatsApp provider abstraction. Only the official Meta WhatsApp Cloud API is
 * supported in production; the mock provider exists for local development and
 * tests and never contacts Meta.
 */
export type MediaKind = "image" | "document" | "audio" | "video";

export type TemplateComponentParam = { type: "text"; text: string };
export type OutboundTemplate = {
  name: string;
  language: string;
  components: { type: "header" | "body"; parameters: TemplateComponentParam[] }[];
};

export type ProviderTemplate = {
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "IN_APPEAL";
  components: unknown[];
  rejectedReason: string | null;
};

export type ConnectionCheck = {
  ok: boolean;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  qualityRating?: string | null;
  error?: string;
};

export interface WhatsAppProvider {
  readonly kind: "meta" | "mock";
  sendText(to: string, body: string): Promise<{ waMessageId: string }>;
  sendTemplate(to: string, template: OutboundTemplate): Promise<{ waMessageId: string }>;
  sendMedia(
    to: string,
    media: { kind: MediaKind; bytes: Buffer; mimeType: string; fileName: string; caption?: string | null },
  ): Promise<{ waMessageId: string }>;
  markRead(waMessageId: string): Promise<void>;
  fetchTemplates(): Promise<ProviderTemplate[]>;
  downloadMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }>;
  testConnection(): Promise<ConnectionCheck>;
}

export type ProviderErrorKind = "permanent" | "retryable" | "rate_limited";

/** Normalized provider failure; `kind` decides retry behaviour in the send job. */
export class WhatsAppProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: ProviderErrorKind,
    public readonly code: string | null = null,
    public readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "WhatsAppProviderError";
  }
}

const PERMANENT_CODES = new Set([
  "131047", // re-engagement message: outside the 24h customer-service window
  "131051", // unsupported message type
  "131026", // message undeliverable (not a WhatsApp user, blocked, old app)
  "131009", // parameter value is not valid
  "131008", // required parameter missing
  "132000", // template parameter count mismatch
  "132001", // template does not exist
  "132005", // template hydrated text too long
  "132007", // template format character policy violated
  "132015", // template paused
  "132016", // template disabled
  "133010", // phone number not registered
  "190", // access token expired / invalid
  "10", // permission denied
  "100", // invalid parameter
  "200", // permissions error
]);
const RATE_LIMIT_CODES = new Set(["130429", "131056", "4", "80007", "131048"]);

/** Maps a Graph API error (HTTP status + error.code) to a retry class. */
export function classifyMetaError(httpStatus: number, code: string | null): ProviderErrorKind {
  if (code && RATE_LIMIT_CODES.has(code)) return "rate_limited";
  if (code && PERMANENT_CODES.has(code)) return "permanent";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus >= 500 || httpStatus === 0) return "retryable";
  if (code === "131000" || code === "1" || code === "2") return "retryable";
  return httpStatus >= 400 ? "permanent" : "retryable";
}

/** Media types WhatsApp accepts for outbound messages, with Meta's size limits. */
export const OUTBOUND_MEDIA: Record<string, { kind: MediaKind; maxBytes: number }> = {
  "image/jpeg": { kind: "image", maxBytes: 5 * 1024 * 1024 },
  "image/png": { kind: "image", maxBytes: 5 * 1024 * 1024 },
  "application/pdf": { kind: "document", maxBytes: 16 * 1024 * 1024 },
  "application/msword": { kind: "document", maxBytes: 16 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "document", maxBytes: 16 * 1024 * 1024 },
  "application/vnd.ms-excel": { kind: "document", maxBytes: 16 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "document", maxBytes: 16 * 1024 * 1024 },
  "text/plain": { kind: "document", maxBytes: 16 * 1024 * 1024 },
  "audio/ogg": { kind: "audio", maxBytes: 16 * 1024 * 1024 },
  "audio/mpeg": { kind: "audio", maxBytes: 16 * 1024 * 1024 },
  "audio/aac": { kind: "audio", maxBytes: 16 * 1024 * 1024 },
  "video/mp4": { kind: "video", maxBytes: 16 * 1024 * 1024 },
};
