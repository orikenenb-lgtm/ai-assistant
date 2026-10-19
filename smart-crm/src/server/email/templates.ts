/** Transactional email templates (Hebrew RTL / English LTR). All values are escaped. */

export type TemplateData = {
  verify_email: { name: string; url: string };
  reset_password: { name: string; url: string };
  account_exists: { name: string; loginUrl: string; resetUrl: string };
  invitation: { orgName: string; inviterName: string; role: string; url: string; expiresAt: string };
  task_reminder: { name: string; taskTitle: string; dueAt: string; url: string };
  notification: { name: string; title: string; body: string; url: string };
  automation_email: { subject: string; body: string };
  quote_sent: { orgName: string; contactName: string; quoteNumber: number; title: string; total: string; validUntil: string | null; url: string };
};
export type EmailTemplate = keyof TemplateData;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Rendered = { subject: string; heading: string; paragraphs: string[]; cta?: { label: string; url: string } };

const COPY: { [K in EmailTemplate]: (d: TemplateData[K], locale: "he" | "en") => Rendered } = {
  verify_email: (d, l) =>
    l === "he"
      ? {
          subject: "אימות כתובת המייל שלך",
          heading: `שלום ${d.name || ""}`.trim(),
          paragraphs: ["תודה שנרשמת ל-SMART CRM AI. כדי להפעיל את החשבון יש לאמת את כתובת המייל.", "הקישור בתוקף ל-24 שעות."],
          cta: { label: "אימות המייל", url: d.url },
        }
      : {
          subject: "Verify your email address",
          heading: `Hi ${d.name || ""}`.trim(),
          paragraphs: ["Thanks for signing up for SMART CRM AI. Please verify your email to activate your account.", "The link is valid for 24 hours."],
          cta: { label: "Verify email", url: d.url },
        },
  reset_password: (d, l) =>
    l === "he"
      ? {
          subject: "איפוס סיסמה",
          heading: `שלום ${d.name || ""}`.trim(),
          paragraphs: ["התקבלה בקשה לאיפוס הסיסמה שלך. הקישור בתוקף לשעה אחת.", "אם לא ביקשת איפוס — אפשר להתעלם מהמייל הזה."],
          cta: { label: "בחירת סיסמה חדשה", url: d.url },
        }
      : {
          subject: "Reset your password",
          heading: `Hi ${d.name || ""}`.trim(),
          paragraphs: ["We received a request to reset your password. The link is valid for one hour.", "If you didn't ask for this, you can ignore this email."],
          cta: { label: "Choose a new password", url: d.url },
        },
  account_exists: (d, l) =>
    l === "he"
      ? {
          subject: "כבר יש לך חשבון",
          heading: `שלום ${d.name || ""}`.trim(),
          paragraphs: ["מישהו ניסה להירשם עם כתובת המייל שלך, אבל כבר קיים לך חשבון.", `שכחת סיסמה? אפשר לאפס כאן: ${d.resetUrl}`],
          cta: { label: "כניסה", url: d.loginUrl },
        }
      : {
          subject: "You already have an account",
          heading: `Hi ${d.name || ""}`.trim(),
          paragraphs: ["Someone tried to sign up with your email address, but you already have an account.", `Forgot your password? Reset it here: ${d.resetUrl}`],
          cta: { label: "Sign in", url: d.loginUrl },
        },
  invitation: (d, l) =>
    l === "he"
      ? {
          subject: `הוזמנת להצטרף ל-${d.orgName}`,
          heading: `הזמנה ל-${d.orgName}`,
          paragraphs: [`${d.inviterName} הזמין/ה אותך להצטרף כ-${d.role}.`, `ההזמנה בתוקף עד ${d.expiresAt}.`],
          cta: { label: "קבלת ההזמנה", url: d.url },
        }
      : {
          subject: `You're invited to join ${d.orgName}`,
          heading: `Join ${d.orgName}`,
          paragraphs: [`${d.inviterName} invited you to join as ${d.role}.`, `The invitation expires on ${d.expiresAt}.`],
          cta: { label: "Accept invitation", url: d.url },
        },
  task_reminder: (d, l) =>
    l === "he"
      ? { subject: `תזכורת: ${d.taskTitle}`, heading: `שלום ${d.name}`, paragraphs: [`תזכורת למשימה "${d.taskTitle}" — יעד: ${d.dueAt}.`], cta: { label: "פתיחת המשימה", url: d.url } }
      : { subject: `Reminder: ${d.taskTitle}`, heading: `Hi ${d.name}`, paragraphs: [`Reminder for "${d.taskTitle}" — due ${d.dueAt}.`], cta: { label: "Open task", url: d.url } },
  notification: (d, l) => ({
    subject: d.title,
    heading: d.title,
    paragraphs: [d.body],
    cta: { label: l === "he" ? "פתיחה" : "Open", url: d.url },
  }),
  automation_email: (d) => ({ subject: d.subject, heading: d.subject, paragraphs: d.body.split(/\n{2,}/) }),
  quote_sent: (d, l) =>
    l === "he"
      ? {
          subject: `הצעת מחיר מס׳ ${d.quoteNumber} מ-${d.orgName}`,
          heading: `שלום ${d.contactName}`.trim(),
          paragraphs: [
            `מצורפת הצעת מחיר "${d.title}" על סך ${d.total}.`,
            ...(d.validUntil ? [`ההצעה בתוקף עד ${d.validUntil}.`] : []),
            "אפשר לצפות בהצעה, להוריד אותה כ-PDF ולאשר אותה בקישור. מסמך זה אינו חשבונית מס.",
          ],
          cta: { label: "צפייה בהצעה", url: d.url },
        }
      : {
          subject: `Quote #${d.quoteNumber} from ${d.orgName}`,
          heading: `Hello ${d.contactName}`.trim(),
          paragraphs: [
            `Please find our quote "${d.title}" for ${d.total}.`,
            ...(d.validUntil ? [`It is valid until ${d.validUntil}.`] : []),
            "You can view it, download the PDF and accept it online. This document is not a tax invoice.",
          ],
          cta: { label: "View quote", url: d.url },
        },
};

export function renderEmail<T extends EmailTemplate>(
  template: T,
  data: TemplateData[T],
  locale: "he" | "en",
): { subject: string; html: string; text: string } {
  const r = COPY[template](data, locale);
  const dir = locale === "he" ? "rtl" : "ltr";
  const align = locale === "he" ? "right" : "left";
  const paragraphs = r.paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.6">${escapeHtml(p)}</p>`).join("");
  const cta = r.cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(r.cta.url)}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(r.cta.label)}</a></p>`
    : "";
  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;padding:24px;text-align:${align}"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px"><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(r.heading)}</h1>${paragraphs}${cta}<p style="color:#888;font-size:12px;margin-top:32px">SMART CRM AI</p></div></body></html>`;
  const text = [r.heading, "", ...r.paragraphs, ...(r.cta ? ["", `${r.cta.label}: ${r.cta.url}`] : [])].join("\n");
  return { subject: r.subject, html, text };
}
