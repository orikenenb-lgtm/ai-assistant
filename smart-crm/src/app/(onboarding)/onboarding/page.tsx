import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getTenantContext } from "@/server/tenancy";
import { listPendingInvitationsForEmail } from "@/modules/org/invitations";
import { OnboardingForm } from "@/modules/org/components/onboarding-form";
import { Card } from "@/components/ui/primitives";
import { requireUser } from "@/server/auth";

export async function generateMetadata() {
  return { title: (await getTranslations("onboarding"))("title") };
}

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const { new: wantsNew } = await searchParams;
  const user = await requireUser();
  if (!wantsNew && (await getTenantContext())) redirect("/dashboard");
  const t = await getTranslations("onboarding");
  const invites = await listPendingInvitationsForEmail(user.email);
  const locale = (await getLocale()) as "he" | "en";
  return (
    <Card className="w-full max-w-lg p-6 shadow-md sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      <OnboardingForm locale={locale} invites={invites} />
    </Card>
  );
}
