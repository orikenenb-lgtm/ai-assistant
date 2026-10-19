import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { Badge, Card } from "@/components/ui/primitives";
import { Logo } from "@/components/layout/logo";

export const metadata = { title: "Dev mailbox" };

/** Development only: shows emails the "log" provider recorded instead of sending. */
export default async function DevMailboxPage() {
  if (env().APP_ENV === "production" || env().EMAIL_PROVIDER !== "log") notFound();
  const emails = await db().select().from(schema.emailOutbox).orderBy(desc(schema.emailOutbox.createdAt)).limit(30);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6" dir="ltr">
      <div className="flex items-center justify-between">
        <Logo />
        <Badge tone="warning">DEVELOPMENT ONLY — nothing here was sent</Badge>
      </div>
      <h1 className="text-xl font-semibold">Dev mailbox</h1>
      {emails.length === 0 && <p className="text-sm text-muted-foreground">No emails yet.</p>}
      {emails.map((m) => {
        const links = [...m.textBody.matchAll(/https?:\/\/\S+/g)].map((x) => x[0]);
        return (
          <Card key={m.id} className="p-4" data-testid="dev-email">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{m.subject}</span>
              <span className="text-muted-foreground">
                {m.toEmail} · {m.createdAt.toISOString().replace("T", " ").slice(0, 19)}
              </span>
            </div>
            <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground" dir="auto">
              {m.textBody}
            </pre>
            {links.map((href) => (
              <a key={href} href={href} className="mt-2 block break-all text-sm font-medium text-primary hover:underline" data-testid="dev-email-link">
                {href}
              </a>
            ))}
          </Card>
        );
      })}
    </div>
  );
}
