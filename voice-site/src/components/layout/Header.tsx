"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { brand, nav } from "@/config/site";
import { Logo } from "@/components/ui/Logo";
import { buttonClass } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4">
      <div
        className={clsx(
          "mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 rounded-full border ps-4 pe-2 transition-[background-color,box-shadow,border-color] duration-300",
          scrolled || open
            ? "border-line bg-surface/85 shadow-card backdrop-blur-xl"
            : "border-white/10 bg-surface/70 backdrop-blur-md",
        )}
      >
        <Link href="/" className="rounded-full" aria-label={`${brand.name}, לעמוד הבית`}>
          <Logo />
        </Link>

        <nav aria-label="ניווט ראשי" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="rounded-full px-3 py-2 text-[0.92rem] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <a href="#contact" className={buttonClass("primary", "sm", "hidden sm:inline-flex")}>
            בואו נקים לכם נציג
          </a>
          <button
            ref={menuButton}
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-full text-ink hover:bg-surface-2 lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "סגירת התפריט" : "פתיחת התפריט"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div
          id="mobile-menu"
          ref={panel}
          className="animate-in mx-auto mt-2 max-w-5xl rounded-3xl border border-line bg-surface p-3 shadow-float lg:hidden"
        >
          <nav aria-label="ניווט במובייל">
            <ul className="grid grid-cols-1 gap-1">
              {nav.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-2xl px-4 py-3 text-lg font-semibold text-ink hover:bg-surface-2"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <a href="#contact" onClick={() => setOpen(false)} className={buttonClass("primary", "lg", "mt-3 w-full")}>
            בואו נקים לכם נציג
          </a>
        </div>
      ) : null}
    </header>
  );
}
