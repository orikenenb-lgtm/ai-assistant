import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { env } from "@/server/env";
import { RegisterForm } from "@/modules/auth/components/register-form";
import { AuthHeading } from "../auth-heading";

export async function generateMetadata() {
  return { title: (await getTranslations("auth"))("register") };
}

export default async function RegisterPage() {
  const t = await getTranslations("auth");
  return (
    <>
      <AuthHeading title={t("registerTitle")} subtitle={t("registerSubtitle")} />
      <RegisterForm devMailbox={env().EMAIL_PROVIDER === "log"} />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t("login")}
        </Link>
      </p>
    </>
  );
}
