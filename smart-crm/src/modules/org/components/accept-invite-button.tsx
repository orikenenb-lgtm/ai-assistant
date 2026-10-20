"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/hooks/use-server-action";
import { acceptInvitationByTokenAction } from "../member-actions";

export function AcceptInviteButton({ token }: { token: string }) {
  const t = useTranslations("invite");
  const router = useRouter();
  const { run, pending } = useServerAction(acceptInvitationByTokenAction);
  return (
    <Button
      className="w-full"
      size="lg"
      loading={pending}
      onClick={async () => {
        const res = await run({ token });
        if (res.ok) {
          router.replace("/dashboard");
          router.refresh();
        }
      }}
    >
      {t("accept")}
    </Button>
  );
}
