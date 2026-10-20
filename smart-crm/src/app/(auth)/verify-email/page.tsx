import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, MailWarning, XCircle } from "lucide-react";
import { env } from "@/server/env";
import { Button } from "@/components/ui/button";

export async function generateMetadata() {
  return { title: (await getTranslations("auth"))("verifyEmailTitle") };
}

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { status } = await searchParams;
  const t = await getTranslations("auth");
  const view =
    status === "verified"
      ? { icon: CheckCircle2, tone: "bg-success-soft text-success-foreground", title: t("verifiedTitle"), body: t("verifiedBody") }
      : status === "invalid"
        ? { icon: XCircle, tone: "bg-danger-soft text-danger-foreground", title: t("invalidLink"), body: t("verifyEmailBody") }
        : { icon: MailWarning, tone: "bg-warning-soft text-warning-foreground", title: t("verifyEmailTitle"), body: t("verifyEmailBody") };
  return (
    <div className="text-center">
      <div className={`mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl ${view.tone}`}>
        <view.icon className="size-6" />
      </div>
      <h1 className="text-xl font-semibold">{view.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{view.body}</p>
      <Button asChild className="mt-6 w-full" size="lg">
        <Link href="/login">{t("login")}</Link>
      </Button>
      {env().EMAIL_PROVIDER === "log" && (
        <a href="/dev/mailbox" className="mt-4 inline-block text-sm text-primary hover:underline">
          {t("devMailbox")}
        </a>
      )}
    </div>
  );
}
