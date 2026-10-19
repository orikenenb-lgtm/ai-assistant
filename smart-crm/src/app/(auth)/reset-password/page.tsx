import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "@/modules/auth/components/password-forms";
import { AuthHeading } from "../auth-heading";

export async function generateMetadata() {
  return { title: (await getTranslations("auth"))("resetTitle") };
}

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  const t = await getTranslations("auth");
  return (
    <>
      <AuthHeading title={t("resetTitle")} />
      <ResetPasswordForm token={typeof token === "string" ? token : undefined} />
    </>
  );
}
