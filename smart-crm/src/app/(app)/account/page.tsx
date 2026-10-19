import { getTranslations } from "next-intl/server";
import { auth, requireUser } from "@/server/auth";
import { getProfile } from "@/modules/account/service";
import { MfaCard, PasswordCard, ProfileCard, SessionsCard } from "@/modules/account/components/account-forms";
import { PageHeader } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: (await getTranslations("account"))("title") };
}

export default async function AccountPage() {
  const user = await requireUser();
  const t = await getTranslations("account");
  const [profile, factors, sessions] = await Promise.all([getProfile(user.userId), auth().mfaFactors(), auth().listSessions()]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ProfileCard initial={profile} />
      <PasswordCard />
      <MfaCard enabled={factors.length > 0} factorId={factors[0]?.id ?? null} canDisable={user.aal === "aal2"} />
      <SessionsCard
        sessions={sessions?.map((s) => ({ id: s.id, current: s.current, userAgent: s.userAgent, ip: s.ip, lastSeenAt: s.lastSeenAt })) ?? null}
      />
    </div>
  );
}
