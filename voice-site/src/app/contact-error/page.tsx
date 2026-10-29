import type { Metadata } from "next";
import Link from "next/link";
import { contact, whatsappLink } from "@/config/site";
import { SimplePage } from "@/components/layout/SimplePage";
import { buttonClass } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "הפרטים לא נשלחו",
  robots: { index: false },
};

/** Landing page for a failed no-JavaScript form submission. */
export default function ContactErrorPage() {
  const wa = whatsappLink("היי, ניסיתי להשאיר פרטים באתר");
  return (
    <SimplePage title="אופס, הפרטים לא נשלחו">
      <p>ייתכן שאחד השדות לא מולא נכון (שם ומספר טלפון הם חובה), או שהייתה תקלה זמנית אצלנו.</p>
      <p className="flex flex-wrap gap-3">
        <Link href="/#contact" className={buttonClass("primary", "lg")}>
          לנסות שוב
        </Link>
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "lg")}>
            לכתוב לנו בוואטסאפ
          </a>
        ) : null}
        {contact.email ? (
          <a href={`mailto:${contact.email}`} className={buttonClass("outline", "lg")}>
            {contact.email}
          </a>
        ) : null}
      </p>
    </SimplePage>
  );
}
