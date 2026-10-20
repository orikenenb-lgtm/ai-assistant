import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { errorFields, logger } from "../logger";
import { renderEmail, type EmailTemplate, type TemplateData } from "./templates";

export type SendEmailInput<T extends EmailTemplate> = {
  to: string;
  template: T;
  data: TemplateData[T];
  locale: "he" | "en";
  tenantId?: string | null;
};

/**
 * Sends a transactional email and records it in email_outbox.
 * EMAIL_PROVIDER=log (development) never sends anything: messages are visible in
 * the dev mailbox at /dev/mailbox.
 */
export async function sendEmail<T extends EmailTemplate>(input: SendEmailInput<T>): Promise<void> {
  const { subject, html, text } = renderEmail(input.template, input.data, input.locale);
  const provider = env().EMAIL_PROVIDER;
  const [row] = await db()
    .insert(schema.emailOutbox)
    .values({
      tenantId: input.tenantId ?? null,
      toEmail: input.to,
      subject,
      html,
      textBody: text,
      template: input.template,
      status: provider === "log" ? "logged" : "queued",
      provider,
    })
    .returning({ id: schema.emailOutbox.id });

  if (provider === "log") {
    logger().info({ emailId: row.id, template: input.template }, "email logged to dev mailbox (not sent)");
    return;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env().RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env().EMAIL_FROM, to: [input.to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(body.message ?? `Resend responded ${res.status}`);
    await db()
      .update(schema.emailOutbox)
      .set({ status: "sent", providerMessageId: body.id ?? null, sentAt: new Date() })
      .where(eqId(row.id));
  } catch (e) {
    logger().error({ emailId: row.id, ...errorFields(e) }, "email send failed");
    await db()
      .update(schema.emailOutbox)
      .set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "send failed" })
      .where(eqId(row.id));
  }
}

const eqId = (id: string) => eq(schema.emailOutbox.id, id);
