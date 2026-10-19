import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MailX, Users } from "lucide-react";
import { getSessionUser } from "@/server/auth";
import { previewInvitation } from "@/modules/org/invitations";
import { AcceptInviteButton } from "@/modules/org/components/accept-invite-button";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("invite"))("title") };
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const t = await getTranslations("invite");
  const tm = await getTranslations("members");
  const ta = await getTranslations("auth");
  const invite = await previewInvitation(token);
  const user = await getSessionUser();
  const next = encodeURIComponent(`/invite/${token}`);

  if (!invite || invite.status !== "valid") {
    return (
      <Card className="w-full max-w-md p-8 text-center">
        <MailX className="mx-auto size-10 text-danger" />
        <h1 className="mt-4 text-xl font-semibold">{t("invalid")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("invalidBody")}</p>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md p-8">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
        <Users className="size-6" />
      </div>
      <h1 className="mt-4 text-xl font-semibold">{t("joinTitle", { org: invite.tenantName })}</h1>
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        {t("asRole")} <Badge tone="primary">{tm(`roles.${invite.role}`)}</Badge>
      </p>
      <div className="mt-6">
        {!user ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("signInToAccept", { email: invite.email })}</p>
            <Button asChild className="w-full">
              <Link href={`/login?next=${next}`}>{ta("login")}</Link>
            </Button>
            <Button asChild variant="secondary" className="w-full">
              <Link href={`/register`}>{ta("register")}</Link>
            </Button>
          </div>
        ) : user.email.toLowerCase() !== invite.email.toLowerCase() ? (
          <Alert tone="warning">{t("wrongEmailBody", { email: invite.email, current: user.email })}</Alert>
        ) : (
          <AcceptInviteButton token={token} />
        )}
      </div>
    </Card>
  );
}
