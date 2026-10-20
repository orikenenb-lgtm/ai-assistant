import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { env } from "@/server/env";
import { ForgotPasswordForm } from "@/modules/auth/components/password-forms";
import { AuthHeading } from "../auth-heading";

export async function generateMetadata() {
  return { title: (await getTranslations("auth"))("forgotTitle") };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth");
  return (
    <>
      <AuthHeading title={t("forgotTitle")} subtitle={t("forgotSubtitle")} />
      <ForgotPasswordForm devMailbox={env().EMAIL_PROVIDER === "log"} />
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t("login")}
        </Link>
      </p>
    </>
  );
}
