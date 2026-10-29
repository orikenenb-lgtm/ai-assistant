"use client";

import { PhoneCall } from "lucide-react";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { buttonClass } from "@/components/ui/Button";
import { StartDemoButton } from "@/components/demo/StartDemoButton";

/** Sticky bottom CTA on phones, shown after the hero and hidden near the form. */
export function MobileCtaBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const contact = document.getElementById("contact");
      const nearForm = contact ? contact.getBoundingClientRect().top < window.innerHeight * 0.9 : false;
      setShow(window.scrollY > window.innerHeight * 0.9 && !nearForm);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={clsx(
        "fixed inset-x-3 bottom-3 z-30 flex gap-2 rounded-full border border-line bg-surface/90 p-1.5 shadow-float backdrop-blur-xl transition-all duration-300 sm:hidden",
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-24 opacity-0",
      )}
      inert={!show}
    >
      <StartDemoButton className={buttonClass("outline", "md", "flex-1 border-0 bg-surface-2")}>
        <PhoneCall className="size-4" aria-hidden="true" /> לשמוע אותה
      </StartDemoButton>
      <a href="#contact" className={buttonClass("primary", "md", "flex-1")}>
        השאירו פרטים
      </a>
    </div>
  );
}
