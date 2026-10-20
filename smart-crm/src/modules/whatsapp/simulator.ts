/**
 * DEV SIMULATOR (mock mode only): builds Meta-shaped webhook payloads, signs
 * them with META_APP_SECRET and POSTs them to the real webhook route, so the
 * complete inbound path (signature, dedupe, queue, processing) is exercised.
 */
import { randomUUID } from "node:crypto";
import { env } from "@/server/env";
import { e164ToWaId } from "@/lib/phone";
import { metaSignature } from "./signature";
import type { MetaWebhookPayload } from "./webhook";

type Acc = { phoneNumberId: string; phoneNumber: string; wabaId: string };

export function buildInboundPayload(
  account: Acc,
  input: { fromPhone: string; name?: string; text?: string; kind?: "text" | "image" | "document"; waMessageId?: string; timestamp?: number },
): MetaWebhookPayload {
  const from = e164ToWaId(input.fromPhone);
  const id = input.waMessageId ?? `wamid.SIM.${randomUUID()}`;
  const timestamp = String(Math.floor((input.timestamp ?? Date.now()) / 1000));
  const message: Record<string, unknown> =
    input.kind === "image"
      ? { from, id, timestamp, type: "image", image: { id: `img-${randomUUID()}`, mime_type: "image/png", caption: input.text || undefined } }
      : input.kind === "document"
        ? { from, id, timestamp, type: "document", document: { id: `doc-${randomUUID()}`, mime_type: "application/pdf", filename: "מסמך.pdf", caption: input.text || undefined } }
        : { from, id, timestamp, type: "text", text: { body: input.text ?? "" } };
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: account.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              metadata: { display_phone_number: e164ToWaId(account.phoneNumber), phone_number_id: account.phoneNumberId },
              contacts: [{ wa_id: from, profile: { name: input.name ?? "" } }],
              messages: [message as never],
            },
          },
        ],
      },
    ],
  };
}

export function buildStatusPayload(account: Acc, input: { waMessageId: string; recipientPhone: string; status: "sent" | "delivered" | "read" | "failed" }): MetaWebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: account.wabaId,
        changes: [
          {
            field: "messages",
            value: {
              metadata: { display_phone_number: e164ToWaId(account.phoneNumber), phone_number_id: account.phoneNumberId },
              statuses: [
                {
                  id: input.waMessageId,
                  status: input.status,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: e164ToWaId(input.recipientPhone),
                  ...(input.status === "failed" ? { errors: [{ code: 131026, title: "Message undeliverable (simulated)" }] } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** POSTs a signed payload to this app's own webhook endpoint. */
export async function postSignedWebhook(payload: MetaWebhookPayload): Promise<number> {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${env().APP_URL}/api/webhooks/whatsapp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": metaSignature(raw, env().META_APP_SECRET ?? "") },
    body: raw,
    signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}
