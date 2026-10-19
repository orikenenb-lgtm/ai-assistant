import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/primitives";
import type { QuoteStatus } from "../status";

const TONES: Record<QuoteStatus, "neutral" | "info" | "primary" | "success" | "danger" | "warning"> = {
  draft: "neutral",
  sent: "info",
  viewed: "primary",
  accepted: "success",
  rejected: "danger",
  expired: "warning",
  canceled: "neutral",
};

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const t = useTranslations("quotes");
  return (
    <Badge tone={TONES[status]} data-testid="quote-status">
      {t(`status.${status}`)}
    </Badge>
  );
}
