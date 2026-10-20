import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSessionUser } from "@/server/auth";
import { MfaChallengeForm } from "@/modules/auth/components/password-forms";
import { safeNext } from "@/modules/auth/schemas";
import { AuthHeading } from "../auth-heading";

export async function generateMetadata() {
  return { title: (await getTranslations("auth"))("mfaTitle") };
}

export default async function MfaPage({ searchParams }: PageProps<"/mfa">) {
  const { next } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const nextPath = safeNext(typeof next === "string" ? next : undefined);
  if (!user.mfaEnrolled || user.aal === "aal2") redirect(nextPath);
  const t = await getTranslations("auth");
  return (
    <>
      <AuthHeading title={t("mfaTitle")} subtitle={t("mfaSubtitle")} />
      <MfaChallengeForm next={nextPath} />
    </>
  );
}
