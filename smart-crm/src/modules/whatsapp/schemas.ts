import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

const metaId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{3,64}$/);

export const connectAccountSchema = z
  .object({
    provider: z.enum(["meta", "mock"]),
    displayName: z.string().trim().min(1).max(100),
    phoneNumber: z
      .string()
      .trim()
      .max(40)
      .transform((v, ctx) => {
        const n = normalizePhone(v);
        if (!n) {
          ctx.addIssue({ code: "custom", message: "validation.phone" });
          return z.NEVER;
        }
        return n;
      }),
    phoneNumberId: metaId,
    wabaId: metaId,
    accessToken: z
      .string()
      .trim()
      .max(2048)
      .optional()
      .transform((v) => (v ? v : undefined)),
    sendRatePerMinute: z.coerce.number().int().min(1).max(1000).default(60),
  })
  .refine((v) => v.provider !== "meta" || (v.accessToken?.length ?? 0) >= 20, {
    path: ["accessToken"],
    message: "whatsapp.tokenRequired",
  });
export type ConnectAccountInput = Omit<z.infer<typeof connectAccountSchema>, "accessToken"> & { accessToken?: string };

export const updateAccountSchema = z.object({
  id: z.uuid(),
  displayName: z.string().trim().min(1).max(100).optional(),
  sendRatePerMinute: z.coerce.number().int().min(1).max(1000).optional(),
  accessToken: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || v.length >= 20, { message: "whatsapp.tokenRequired" }),
});

export const simulateInboundSchema = z.object({
  accountId: z.uuid(),
  fromPhone: z
    .string()
    .trim()
    .max(40)
    .transform((v, ctx) => {
      const n = normalizePhone(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message: "validation.phone" });
        return z.NEVER;
      }
      return n;
    }),
  name: z.string().trim().max(100).default(""),
  text: z.string().trim().max(4096).default(""),
  kind: z.enum(["text", "image", "document"]).default("text"),
});

export const simulateStatusSchema = z.object({
  conversationId: z.uuid(),
  status: z.enum(["delivered", "read", "failed"]),
});
