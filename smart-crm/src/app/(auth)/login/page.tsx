import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/auth";
import { LoginForm } from "@/modules/auth/components/login-form";
import { safeNext } from "@/modules/auth/schemas";
import { AuthHeading } from "../auth-heading";

export async function generateMetadata() {
  return { title: (await getTranslations("auth"))("login") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = safeNext(typeof next === "string" ? next : undefined);
  const user = await getSessionUser();
  if (user?.emailVerified && (!user.mfaEnrolled || user.aal === "aal2")) redirect(nextPath);
  const t = await getTranslations("auth");
  return (
    <>
      <AuthHeading title={t("loginTitle")} subtitle={t("loginSubtitle")} />
      <LoginForm next={nextPath} />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          {t("register")}
        </Link>
      </p>
    </>
  );
}
