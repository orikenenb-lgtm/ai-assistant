import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { contact } from "@/config/site";
import { SimplePage } from "@/components/layout/SimplePage";
import { buttonClass } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "תודה, קיבלנו",
  robots: { index: false },
};

/** Landing page for the no-JavaScript form submission. */
export default function ThanksPage() {
  return (
    <SimplePage title="תודה, קיבלנו את הפרטים!">
      <p className="flex items-center gap-3 text-lg">
        <CheckCircle2 className="size-8 shrink-0 text-brand" aria-hidden="true" />
        נחזור אליכם {contact.responseTime}.
      </p>
      <p>בינתיים אפשר לחזור לעמוד הבית ולדבר עם הנציגה שלנו, כדי לשמוע איך זה יישמע אצלכם.</p>
      <p>
        <Link href="/#demo" className={buttonClass("primary", "lg")}>
          לדבר עם הנציגה
        </Link>
      </p>
    </SimplePage>
  );
}
