"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/layout/status-page";

/** Unexpected errors: a localized message and a retry, never internal details. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  const tc = useTranslations("common");
  useEffect(() => {
    console.error(error.digest ?? error.message);
  }, [error]);
  return (
    <StatusPage
      kind="error"
      title={t("pageErrorTitle")}
      body={t("pageErrorBody")}
      homeLabel={t("goHome")}
      action={
        <Button onClick={reset}>
          <RotateCcw /> {tc("retry")}
        </Button>
      }
    />
  );
}
